import {
    DisabledContractMethodRule,
    EpochPatches,
    IOPNetConsensus,
    IOPNetConsensusObj,
    OPNetEnabledConfigs,
} from './types/IOPNetConsensus.js';
import { Consensus } from './consensus/Consensus.js';
import { RoswellConsensus } from './consensus/RoswellConsensus.js';
import { Logger } from '@btc-vision/bsi-common';
import { Config } from '../../config/Config.js';
import { SpecialContract } from './types/SpecialContracts.js';
import { ConsensusRules } from '../../vm/consensus/ConsensusRules.js';
import { OPVMVersion } from '../../vm/rust/versions/OPVMVersion.js';

class OPNetConsensusConfiguration extends Logger {
    private blockHeight: bigint = 0n;
    private imminentConsensusBlockDifference: bigint = 1008n;
    private consensusUpgradeCallbacks: ((consensus: string, isReady: boolean) => void)[] = [];

    private readonly allConsensus: IOPNetConsensusObj = {
        [Consensus.Roswell]: RoswellConsensus,
        //[Consensus.Rachel]: RachelConsensus,
        //[Consensus.Kecksburg]: KecksburgConsensus,
    };

    #consensus: IOPNetConsensus<Consensus> | undefined;

    public constructor() {
        super();
    }

    public get consensus(): IOPNetConsensus<Consensus> {
        if (!this.#consensus) {
            throw new Error('Consensus not set.');
        }

        return this.#consensus;
    }

    public get consensusEpochPatches(): EpochPatches {
        const chainConfig = OPNetConsensus.consensus.EPOCH.PATCH[Config.BITCOIN.CHAIN_ID];
        if (!chainConfig) {
            throw new Error('Chain not supported');
        }

        const networkConfig = chainConfig[Config.BITCOIN.NETWORK];
        if (!networkConfig) {
            throw new Error('Network not supported');
        }

        return networkConfig;
    }

    /**
     * Whether the storage-state merkle leaf binds the contract address at the
     * given block height, hash(address || pointer || value). Returns false (the
     * legacy address-less leaf) when the network has no configured activation
     * height or the height has not been reached.
     */
    public bindsContractAddressInStateProof(blockHeight: bigint): boolean {
        const chain =
            OPNetConsensus.consensus.CONTRACTS.STATE_PROOF_ADDRESS_BINDING[Config.BITCOIN.CHAIN_ID];
        const activation = chain?.[Config.BITCOIN.NETWORK];

        return activation !== undefined && blockHeight >= activation;
    }

    /**
     * Which op-vm build must execute the given block. Blocks strictly below the
     * configured activation height replay on the pinned 1.0.0 runtime; the
     * activation height itself and everything above run the current one.
     *
     * A network with no configured height has no 1.0.0 history and always uses
     * the current runtime.
     */
    public opVmVersionForBlock(blockHeight: bigint): OPVMVersion {
        const chain =
            OPNetConsensus.consensus.CONTRACTS.OP_VM_LATEST_ACTIVATION[Config.BITCOIN.CHAIN_ID];
        const activation = chain?.[Config.BITCOIN.NETWORK];

        if (activation === undefined) {
            return OPVMVersion.Latest;
        }

        return blockHeight < activation ? OPVMVersion.Legacy : OPVMVersion.Latest;
    }

    /**
     * Whether an ML-DSA link request is forbidden from claiming a
     * `hashedPublicKey` that is already a deployed contract address.
     *
     * A network with no configured height enforces the guard from genesis: a
     * chain with no pre-fork history cannot have relied on the broken behaviour,
     * and defaulting an unconfigured network to "exploitable" is never correct.
     */
    public enforcesMLDSAIdentityBinding(blockHeight: bigint): boolean {
        const chain =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_IDENTITY_BINDING_GUARD[
                Config.BITCOIN.CHAIN_ID
            ];
        const activation = chain?.[Config.BITCOIN.NETWORK];

        return activation === undefined || blockHeight >= activation;
    }

    /**
     * Whether a link request that creates a NEW identity must reveal the ML-DSA
     * public key and a signature over it.
     *
     * Split out of MLDSA_IDENTITY_BINDING_GUARD so the two rules can move
     * independently; the configured heights currently match it exactly, so this
     * reproduces the behaviour v1.1.2 already enforces.
     *
     * This is the ONLY rule that stops an attacker adopting a 32-byte identity
     * they hold no preimage for -- including one that already holds a balance but
     * has never been linked -- so it fails CLOSED: a network with no configured
     * height enforces from genesis. It does reject the link request that
     * `@btc-vision/transaction` below 1.8.9 builds, so clients must be on a
     * revealing build.
     */
    public requiresMLDSARevealOnNewLink(blockHeight: bigint): boolean {
        const chain =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_REVEAL_REQUIRED_ON_NEW_LINK[
                Config.BITCOIN.CHAIN_ID
            ];
        const activation = chain?.[Config.BITCOIN.NETWORK];

        return activation === undefined || blockHeight >= activation;
    }

    /**
     * Whether a contract may be deployed onto an address that is already an
     * ML-DSA identity.
     *
     * The mirror of {@link enforcesMLDSAIdentityBinding}, which only covers the
     * link-then-check direction. Kept on its own height because it is a NEW rule:
     * sharing the guard's already-passed activation would retroactively
     * invalidate historical deployments.
     *
     * Fails CLOSED, like the guard it mirrors.
     */
    public enforcesMLDSADeployIdentityGuard(blockHeight: bigint): boolean {
        const chain =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_DEPLOY_IDENTITY_GUARD[
                Config.BITCOIN.CHAIN_ID
            ];
        const activation = chain?.[Config.BITCOIN.NETWORK];

        return activation === undefined || blockHeight >= activation;
    }

    public get allowUnsafeSignatures(): boolean {
        if (!this.#consensus) {
            throw new Error('Consensus not set.');
        }

        return this.#consensus.VM.CONSENSUS_RULES.containsFlag(
            ConsensusRules.UNSAFE_QUANTUM_SIGNATURES_ALLOWED,
        );
    }

    public get consensusRules(): ConsensusRules {
        if (!this.#consensus) {
            throw new Error('Consensus not set.');
        }

        return this.#consensus.VM.CONSENSUS_RULES;
    }

    public get opnetEnabled(): OPNetEnabledConfigs {
        const chain = this.consensus.OPNET_ENABLED[Config.BITCOIN.CHAIN_ID];
        if (!chain) {
            return {
                ENABLED: false,
                BLOCK: 0n,
            };
        }

        const network = chain[Config.BITCOIN.NETWORK];
        if (!network) {
            return {
                ENABLED: false,
                BLOCK: 0n,
            };
        }

        return network;
    }

    public allowContractUpdates(): boolean {
        if (!this.#consensus) {
            throw new Error('Consensus not set.');
        }

        return this.#consensus.VM.CONSENSUS_RULES.containsFlag(
            ConsensusRules.CONTRACT_UPDATES_ALLOWED,
        );
    }

    public calculateCurrentEpoch(blockHeight: bigint): bigint {
        // Each epoch contains BLOCKS_PER_EPOCH blocks (typically 5)
        // Epoch 0: blocks 0-4
        // Epoch 1: blocks 5-9
        // Epoch 2: blocks 10-14
        // And so on...

        // Integer division gives us the epoch number
        // blockHeight 0-4 / 5 = 0 (epoch 0)
        // blockHeight 5-9 / 5 = 1 (epoch 1)
        // blockHeight 10-14 / 5 = 2 (epoch 2)

        if (blockHeight < 0n) {
            throw new Error(
                `Invalid block height: ${blockHeight}. Block height must be non-negative.`,
            );
        }

        return blockHeight / this.consensus.EPOCH.BLOCKS_PER_EPOCH;
    }

    public addConsensusUpgradeCallback(
        callback: (consensus: string, isReady: boolean) => void,
    ): void {
        this.consensusUpgradeCallbacks.push(callback);
    }

    public isNextConsensusImminent(): boolean {
        return (
            this.consensus.GENERIC.NEXT_CONSENSUS_BLOCK - this.blockHeight <=
            this.imminentConsensusBlockDifference
        );
    }

    public specialContract(address: string): SpecialContract | undefined {
        const chain = this.consensus.CONTRACTS.SPECIAL_CONTRACTS[Config.BITCOIN.CHAIN_ID];
        if (!chain) {
            return;
        }

        const network = chain[Config.BITCOIN.NETWORK];
        if (!network) {
            return;
        }

        return network[address];
    }

    public disabledContractMethodError(
        blockHeight: bigint,
        calldata: Uint8Array,
    ): string | undefined {
        if (calldata.length < 4) {
            return;
        }

        const selector = OPNetConsensusConfiguration.readSelector(calldata);
        const rules = this.disabledContractMethodRules();
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            if (!rule || blockHeight < rule.ENABLE_AT_BLOCK) {
                continue;
            }

            if (rule.SELECTORS.includes(selector)) {
                return rule.ERROR;
            }
        }
    }

    public isConsensusBlock(): boolean {
        return this.consensus.GENERIC.NEXT_CONSENSUS_BLOCK === this.blockHeight;
    }

    public getBlockHeight(): bigint {
        return this.blockHeight;
    }

    public isReadyForNextConsensus(): boolean {
        return this.consensus.GENERIC.IS_READY_FOR_NEXT_CONSENSUS;
    }

    public hasConsensus(): boolean {
        return !!this.#consensus;
    }

    public setBlockHeight(blockHeight: bigint, wasReorg: boolean = false): void {
        if (Config.OP_NET.REINDEX && !this.#consensus && !wasReorg) {
            blockHeight = BigInt(Config.OP_NET.REINDEX_FROM_BLOCK);
        }

        this.blockHeight = blockHeight;

        if (!this.#consensus) {
            this.updateConfigurations();
        }

        if (this.#consensus && this.#consensus.GENERIC.NEXT_CONSENSUS_BLOCK <= blockHeight) {
            this.enforceNextConsensus();
        }
    }

    /**
     * Enforce the next consensus.
     * @private
     */
    private enforceNextConsensus(): void {
        const nextConsensus: Consensus = this.consensus.GENERIC.NEXT_CONSENSUS;
        if (!nextConsensus) {
            throw new Error('Next consensus not set.');
        }

        const isReady: boolean = this.consensus.GENERIC.IS_READY_FOR_NEXT_CONSENSUS;
        this.triggerConsensusEnforcementCallbacks(isReady);

        // Ensure that something will error if the next consensus is not set.
        this.#consensus = undefined;

        if (!isReady) {
            throw new Error('Next consensus is not ready.');
        }

        const consensusConfig = this.allConsensus[nextConsensus];
        if (!consensusConfig) {
            throw new Error('Next consensus not found.');
        }

        this.#consensus = consensusConfig;
    }

    private triggerConsensusEnforcementCallbacks(wasReady: boolean): void {
        const nextConsensusName = Consensus[this.consensus.GENERIC.NEXT_CONSENSUS];

        for (const callback of this.consensusUpgradeCallbacks) {
            callback(nextConsensusName, wasReady);
        }
    }

    private disabledContractMethodRules(): readonly DisabledContractMethodRule[] {
        const chain = this.consensus.CONTRACTS.DISABLED_METHODS[Config.BITCOIN.CHAIN_ID];
        if (!chain) {
            return [];
        }

        const network = chain[Config.BITCOIN.NETWORK];
        if (!network) {
            return [];
        }

        return network;
    }

    private static readSelector(calldata: Uint8Array): number {
        const view = new DataView(calldata.buffer, calldata.byteOffset, calldata.byteLength);

        return view.getUint32(0, false);
    }

    /**
     * Get the current consensus configuration.
     * @private
     */
    private updateConfigurations(): void {
        for (const consensus of Object.keys(this.allConsensus)) {
            const consensusConfig = this.allConsensus[consensus as unknown as Consensus];
            if (!consensusConfig) {
                this.panic(`UPGRADE YOUR NODE IMMEDIATELY! Consensus ${consensus} not found.`);
                process.exit(1);
            }

            if (consensusConfig.GENERIC.ENABLED_AT_BLOCK > this.blockHeight) {
                continue;
            }

            this.#consensus = consensusConfig;

            if (consensusConfig.GENERIC.NEXT_CONSENSUS_BLOCK >= this.blockHeight) {
                break;
            }

            if (!consensusConfig.GENERIC.IS_READY_FOR_NEXT_CONSENSUS) {
                this.panic(
                    `UPGRADE YOUR NODE IMMEDIATELY! Consensus ${consensusConfig.CONSENSUS_NAME} is not ready.`,
                );
                process.exit(1);
            }
        }
    }
}

export const OPNetConsensus: OPNetConsensusConfiguration = new OPNetConsensusConfiguration();
