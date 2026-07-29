import { Consensus } from '../consensus/Consensus.js';
import { BitcoinNetwork } from '../../../config/network/BitcoinNetwork.js';
import { SpecialContracts } from './SpecialContracts.js';
import { ChainIds } from '../../../config/enums/ChainIds.js';
import { Address, MLDSASecurityLevel } from '@btc-vision/transaction';
import { ConsensusRules } from '../../../vm/consensus/ConsensusRules.js';

export enum TransactionInputFlags {
    hasCoinbase = 0b00000001,
    hasWitnesses = 0b00000010,
}

export enum TransactionOutputFlags {
    hasTo = 0b00000001,
    hasScriptPubKey = 0b00000010,
    OP_RETURN = 0b00000100,
}

export interface OPNetEnabledConfigs {
    readonly ENABLED: boolean;
    readonly BLOCK: bigint;
}

export interface EarlyMiningConfig {
    readonly ENABLED: boolean;
    readonly WHITELISTED_PUBLIC_KEY?: Address;
    readonly EXPIRES_AT_BLOCK?: bigint;
    readonly PATCH_2_ENABLE_AT_BLOCK?: bigint;
    readonly EXPIRES_AT_BLOCK_PATCH_2?: bigint;
}

export interface EpochPatches {
    readonly GRAFFITI_LENGTH_PATCH_BLOCK_HEIGHT: bigint;

    /**
     * Block height at which the epoch mining preimage switches from the legacy
     * malleable XOR construction (checksumRoot ^ publicKey ^ salt) to the
     * non-malleable concatenation (checksumRoot || publicKey || salt), still
     * hashed with SHA-1. Must be a multiple of EPOCH.BLOCKS_PER_EPOCH so no epoch
     * straddles the switch, and MUST match the activation height used by
     * @btc-vision/transaction and the mining pool.
     */
    readonly PREIMAGE_CONCAT_PATCH_BLOCK_HEIGHT: bigint;
}

export interface DisabledContractMethodRule {
    readonly ENABLE_AT_BLOCK: bigint;
    readonly SELECTORS: readonly number[];
    readonly ERROR: string;
}

export interface IOPNetConsensus<T extends Consensus> {
    /** Information about the consensus */
    // The consensus type.
    readonly CONSENSUS: T;

    // The consensus name.
    readonly CONSENSUS_NAME: string;

    readonly OPNET_ENABLED: {
        // The consensus is enabled for this network.
        readonly [key in ChainIds]?: {
            readonly [key in BitcoinNetwork]?: OPNetEnabledConfigs;
        };
    };

    readonly PROTOCOL_ID: Uint8Array;

    readonly EPOCH: {
        readonly ENABLED: boolean;

        /** There is an epoch change every X blocks */
        readonly BLOCKS_PER_EPOCH: bigint;

        readonly MIN_DIFFICULTY: number;

        readonly GENESIS_PROPOSER_PUBLIC_KEY: Address;

        readonly GRAFFITI_LENGTH: number;

        readonly TIMELOCK_BLOCKS_REWARD: number;

        readonly SOLUTION_LIFETIME: bigint;

        readonly EARLY_MINING?: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: EarlyMiningConfig;
            };
        };

        readonly PATCH: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: EpochPatches;
            };
        };
    };

    readonly GENERIC: {
        /** General consensus properties */
        // The block height at which this consensus was enabled.
        readonly ENABLED_AT_BLOCK: bigint;

        // The next consensus.
        readonly NEXT_CONSENSUS: Consensus;

        // The block height at which the next consensus will be enabled.
        readonly NEXT_CONSENSUS_BLOCK: bigint;

        // Is this node updated to the next consensus?
        readonly IS_READY_FOR_NEXT_CONSENSUS: boolean;

        // Allow legacy? Hybrid contract address are supported in this version.
        readonly ALLOW_LEGACY: boolean;
    };

    readonly POW: {
        readonly PREIMAGE_LENGTH: number;
    };

    /** Contracts related rules */
    readonly CONTRACTS: {
        /** The maximum size of a calldata in bytes. */
        readonly MAXIMUM_CONTRACT_SIZE_COMPRESSED: number;

        /** The maximum size of calldata in bytes. */
        readonly MAXIMUM_CALLDATA_SIZE_COMPRESSED: number;

        /** Special contracts */
        readonly SPECIAL_CONTRACTS: {
            // The consensus is enabled for this network.
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: SpecialContracts;
            };
        };

        readonly DISABLED_METHODS: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: readonly DisabledContractMethodRule[];
            };
        };

        /**
         * Block height at/after which the storage-state merkle leaf binds the
         * contract address, hash(address || pointer || value) instead of just
         * hash(pointer || value), so a proof for (pointer,value) can no longer be
         * replayed across contracts. This changes the committed storageRoot, so it
         * is a HARD FORK: the value MUST be a future block (ahead of the tip) and
         * MUST match the client-side verifier (@btc-vision/opnet). An undefined or
         * unreached height keeps the legacy (address-less) leaf.
         */
        readonly STATE_PROOF_ADDRESS_BINDING: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: bigint;
            };
        };

        /**
         * Block height at which @btc-vision/op-vm 1.1.0 takes over from 1.0.0.
         * Blocks strictly BELOW this height are replayed on the pinned 1.0.0
         * runtime, which is the only way to reproduce the state they originally
         * committed; the height itself and everything above run on the current
         * runtime. 1.1.0 changes execution semantics, so this is a HARD FORK and
         * the value MUST match every other node.
         *
         * A network with NO entry has no 1.0.0 history and always uses the
         * current runtime. This is deliberately the opposite default from
         * STATE_PROOF_ADDRESS_BINDING above: an unconfigured network must never
         * silently fall back to a superseded VM.
         */
        readonly OP_VM_LATEST_ACTIVATION: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: bigint;
            };
        };

        /**
         * Block height at which ML-DSA identity binding is enforced.
         *
         * An OPNet identity is literally the 32 bytes of `hashedPublicKey`
         * (Address.setMldsaKey stores a 32-byte input verbatim), and a link
         * request's Schnorr signature only proves the sender owns the BITCOIN
         * key being linked; it proves nothing about the claimed hash. From this
         * height a link may not claim a `hashedPublicKey` that is already a
         * deployed contract address: contract addresses share that same 32-byte
         * space and are never written to the ML-DSA store, so no uniqueness
         * check could see them, and the claimant would then transact AS the
         * contract.
         *
         * Rejecting these changes which transactions are valid, so this is a
         * HARD FORK and every node must use the same height.
         */
        readonly MLDSA_IDENTITY_BINDING_GUARD: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: bigint;
            };
        };

        /**
         * Block height at which a NEW ML-DSA link must reveal the ML-DSA public
         * key and a valid ML-DSA signature over it.
         *
         * Without the reveal nothing ties `hashedPublicKey` to a key the sender
         * actually holds, so an unclaimed 32-byte value can be squatted as an
         * identity. That is worth closing, but unlike the contract-address guard
         * it rejects transactions honest clients still build: not revealing is
         * the protocol's documented default (a reveal costs ~3.7 KB on-chain for
         * ML-DSA-44) and `@btc-vision/transaction` only started revealing by
         * default in 1.8.9. Enabling it before clients have migrated bricks the
         * first interaction of every new wallet.
         *
         * Leave unset until the ecosystem is on a revealing client. Unset means
         * NOT enforced.
         *
         * Rejecting these changes which transactions are valid, so this is a
         * HARD FORK and every node must use the same height.
         */
        readonly MLDSA_REVEAL_REQUIRED_ON_NEW_LINK: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: bigint;
            };
        };

        /**
         * Block height at which a contract may not be DEPLOYED onto an address
         * that is already an ML-DSA identity.
         *
         * MLDSA_IDENTITY_BINDING_GUARD only asks whether the claimed hash is a
         * contract at the moment of LINKING, so reversing the order walks past it:
         * claim the address of a contract that does not exist yet, then deploy it.
         * Contract addresses are `hash256(xonly(deployerPubKey) || saltHash ||
         * hash256(bytecode))`, deterministic in inputs the deployer chooses, so the
         * address is known before the link is broadcast and no race is involved.
         *
         * This is a genuinely NEW rule rather than a restatement of an existing
         * one, so it gets its own height instead of sharing the guard's: applying
         * it at the guard's already-passed activation would retroactively
         * invalidate any historical deployment that happened to land on a claimed
         * identity. Set it AHEAD of the tip.
         *
         * Rejecting these changes which transactions are valid, so this is a
         * HARD FORK and every node must use the same height.
         */
        readonly MLDSA_DEPLOY_IDENTITY_GUARD: {
            readonly [key in ChainIds]?: {
                readonly [key in BitcoinNetwork]?: bigint;
            };
        };
    };

    readonly COMPRESSION: {
        MAX_DECOMPRESSED_SIZE: number;
    };

    readonly MLDSA: {
        readonly ENABLED_LEVELS: MLDSASecurityLevel[];
        readonly MAX_LOADS: number;
    };

    /** Transactions related properties */
    readonly GAS: {
        readonly COST: {
            readonly COLD_STORAGE_LOAD: bigint;
        };

        /** How many sat of gas is equal to 1 sat of priority */
        readonly GAS_PENALTY_FACTOR: bigint;

        /** Target block gas limit */
        readonly TARGET_GAS: bigint;

        /** Smooth out gas increase when equal to gas target. */
        readonly SMOOTH_OUT_GAS_INCREASE: bigint;

        /**
         * Maximum theoretical upper limit, all transactions after this limit will revert for being out of gas.
         * Can overflow up to the value set to TRANSACTION_MAX_GAS.
         */
        readonly MAX_THEORETICAL_GAS: bigint;

        /** Max gas per transactions */
        readonly TRANSACTION_MAX_GAS: bigint;

        /** btc_call maximum gas */
        readonly EMULATION_MAX_GAS: bigint;

        /** Panic gas cost */
        readonly PANIC_GAS_COST: bigint;

        /** Converts satoshi to BTC */
        readonly SAT_TO_GAS_RATIO: bigint;

        /** Minimum base gas, sat/gas unit */
        readonly MIN_BASE_GAS: number;

        /** Smoothing factor for EMA */
        readonly SMOOTHING_FACTOR: number;

        /** Adjustment factor when G_t > G_targetBlock */
        readonly ALPHA1: number;

        /** Adjustment factor when G_t <= G_targetBlock */
        readonly ALPHA2: number;

        /** Target utilization ratio */
        readonly U_TARGET: number;
    };

    readonly TRANSACTIONS: {
        readonly EVENTS: {
            /** The maximum size of an event in bytes */
            readonly MAXIMUM_EVENT_LENGTH: number;

            /** The maximum size of all events combined  */
            readonly MAXIMUM_TOTAL_EVENT_LENGTH: number;

            /** The maximum length of an event name */
            readonly MAXIMUM_EVENT_NAME_LENGTH: number;
        };

        /** The maximum size of a receipt in bytes */
        readonly MAXIMUM_RECEIPT_LENGTH: number;

        /** The maximum amount of contract a transaction can deploy */
        readonly MAXIMUM_DEPLOYMENT_DEPTH: number;

        /**
         * The maximum amount of contract updates a transaction can perform
         */
        readonly MAXIMUM_UPDATE_DEPTH: number;

        /** The maximum amount of calls possible in a transaction */
        readonly MAXIMUM_CALL_DEPTH: number;

        /** The cost of a byte in gas */
        readonly STORAGE_COST_PER_BYTE: bigint;

        /** Check for reentrancy */
        readonly REENTRANCY_GUARD: boolean;

        /** Skip proof validation for execution before transaction */
        readonly SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION: boolean;

        /** Is the access list feature enabled? */
        readonly ENABLE_ACCESS_LIST: boolean;
    };

    readonly VM: {
        readonly CONSENSUS_RULES: ConsensusRules;

        readonly CURRENT_DEPLOYMENT_VERSION: number;

        readonly UTXOS: {
            /** The maximum inputs utxos to forward to a contract */
            readonly MAXIMUM_INPUTS: number;

            /** The maximum outputs utxos to forward to a contract */
            readonly MAXIMUM_OUTPUTS: number;

            /** Write input and output flags to the transaction. */
            readonly WRITE_FLAGS: boolean;

            readonly INPUTS: {
                /** Write coinbase to the transaction. */
                readonly WRITE_COINBASE: boolean;

                /** Write witnesses to the transaction. */
                readonly WRITE_WITNESSES: boolean;
            };

            readonly OUTPUTS: {
                /** Write scriptPubKey to the transaction. */
                readonly WRITE_SCRIPT_PUB_KEY: boolean;
            };

            readonly OP_RETURN: {
                /** Enable OP_RETURN outputs */
                readonly ENABLED: boolean;

                /** The maximum size of an OP_RETURN output in bytes */
                readonly MAXIMUM_SIZE: number;
            };
        };
    };

    readonly NETWORK: {
        /** Networking */
        // Define the maximum size of a transaction that can be broadcasted.
        readonly MAXIMUM_TRANSACTION_BROADCAST_SIZE: number;

        // Define the maximum size of a PSBT transaction that can be broadcasted.
        readonly PSBT_MAXIMUM_TRANSACTION_BROADCAST_SIZE: number;
    };

    readonly PSBT: {
        // Define the minimum fee rate that must be paid for a PSBT to be accepted.
        readonly MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT: bigint;
    };
}

export type IOPNetConsensusObj = {
    [key in Consensus]?: IOPNetConsensus<key>;
};
