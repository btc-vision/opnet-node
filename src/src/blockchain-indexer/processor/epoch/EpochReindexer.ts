import { Logger } from '@btc-vision/bsi-common';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { EpochManager } from './EpochManager.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';

export class EpochReindexer extends Logger {
    public readonly logColor: string = '#ff9900';

    private isReindexing: boolean = false;
    private aborted: boolean = false;

    constructor(
        private readonly vmStorage: VMStorage,
        private readonly epochManager: EpochManager,
    ) {
        super();
    }

    /*public abort(): void {
        this.aborted = true;
        this.warn('Epoch reindex abort requested');
    }*/

    public async reindexEpochs(fromEpoch: bigint, currentBlockHeight: bigint): Promise<boolean> {
        if (this.isReindexing) {
            throw new Error('Epoch reindex already in progress');
        }

        this.isReindexing = true;
        this.aborted = false;

        try {
            const blocksPerEpoch = OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;

            const lastCompletedEpoch =
                currentBlockHeight > 0n ? currentBlockHeight / blocksPerEpoch - 1n : -1n;

            if (lastCompletedEpoch < 0n) {
                this.warn('No completed epochs to reindex');
                return true;
            }

            if (fromEpoch > lastCompletedEpoch) {
                this.warn(
                    `Starting epoch ${fromEpoch} > last completed epoch ${lastCompletedEpoch}`,
                );
                return true;
            }

            const totalEpochs = lastCompletedEpoch - fromEpoch + 1n;

            this.info(
                `Starting epoch reindex process from epoch ${fromEpoch} to ${lastCompletedEpoch}... (total ${totalEpochs} epochs)`,
            );

            await this.vmStorage.deleteEpochsFromEpochNumber(fromEpoch);

            this.success(`Existing epochs deleted`);

            const startTime = Date.now();
            for (let epochNum = fromEpoch; epochNum <= lastCompletedEpoch; epochNum++) {
                if (this.aborted) {
                    this.warn(`Epoch reindex aborted at epoch ${epochNum}`);
                    return false;
                }

                if (epochNum % 100n === 0n) {
                    const completed = epochNum - fromEpoch;
                    const percent = ((Number(completed) / Number(totalEpochs)) * 100).toFixed(1);
                    const elapsed = Date.now() - startTime;
                    const avgPerEpoch = completed > 0n ? elapsed / Number(completed) : 0;
                    const remaining = Number(totalEpochs) - Number(completed);
                    const etaMinutes = Math.ceil((avgPerEpoch * remaining) / 60000);

                    this.info(
                        `[${percent}%] Reindexing epoch ${epochNum}/${lastCompletedEpoch} ` +
                            `(ETA: ${etaMinutes}min)...`,
                    );
                }

                try {
                    await this.epochManager.finalizeEpochCompletion(epochNum);
                } catch (error) {
                    this.panic(`Failed to reindex epoch ${epochNum}: ${error}`);
                    this.logMissingDependencies(epochNum, blocksPerEpoch);

                    throw error;
                }
            }

            const totalTime = (Date.now() - startTime) / 1000;
            this.success(`---- EPOCH REINDEX COMPLETED ----`);
            this.success(`Total epochs: ${totalEpochs}`);
            this.success(`Took ${totalTime.toFixed(2)}s`);
            this.success(`Avg per epoch: ${(totalTime / Number(totalEpochs)).toFixed(3)}s`);

            return true;
        } finally {
            this.isReindexing = false;
        }
    }

    private logMissingDependencies(epochNum: bigint, blocksPerEpoch: bigint): void {
        const startBlock = epochNum * blocksPerEpoch;
        const endBlock = startBlock + blocksPerEpoch - 1n;

        this.error(`Possible missing dependencies for epoch ${epochNum}:`);
        this.error(`  - Previous epoch hash (epoch ${epochNum - 1n})`);
        this.error(
            `  - Attestation checksum root (epoch ${epochNum - (OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH - 1n)})`,
        );
        this.error(`  - Block witnesses for blocks ${startBlock} to ${endBlock}`);
        this.error(`  - Epoch submissions for epoch ${epochNum}`);
        this.error(`  - Block headers with checksumRoot for blocks ${startBlock} to ${endBlock}`);
    }
}
