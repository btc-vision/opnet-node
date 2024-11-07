import { IOPNetConsensus, IOPNetConsensusObj } from './types/IOPNetConsensus.js';
import { Consensus } from './consensus/Consensus.js';
import { RoswellConsensus } from './consensus/RoswellConsensus.js';
import { Logger } from '@btc-vision/bsi-common';
import { Config } from '../../config/Config.js';

class OPNetConsensusConfiguration extends Logger {
    private blockHeight: bigint = 0n;
    private imminentConsensusBlockDifference: bigint = 1008n;
    private consensusUpgradeCallbacks: ((consensus: string, isReady: boolean) => void)[] = [];

    private readonly allConsensus: IOPNetConsensusObj = {
        [Consensus.Roswell]: RoswellConsensus,
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

    public setBlockHeight(blockHeight: bigint): void {
        if (Config.OP_NET.REINDEX && !this.#consensus) {
            blockHeight = BigInt(Config.OP_NET.REINDEX_FROM_BLOCK);
        }

        this.blockHeight = blockHeight;

        if (!this.#consensus) {
            this.updateConfigurations();
        } else if (this.#consensus.GENERIC.NEXT_CONSENSUS_BLOCK <= blockHeight) {
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
