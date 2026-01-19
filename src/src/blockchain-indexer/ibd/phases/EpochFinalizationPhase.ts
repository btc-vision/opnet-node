/**
 * Epoch Finalization Phase
 * Finalizes epochs after checksums and witnesses are ready
 * This phase runs AFTER checksum generation and witness sync
 */

import { Logger } from '@btc-vision/bsi-common';
import { IBDProgressTracker } from '../IBDProgressTracker.js';
import { IBDPhase } from '../interfaces/IBDState.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { EpochManager } from '../../processor/epoch/EpochManager.js';

export class EpochFinalizationPhase extends Logger {
    public readonly logColor: string = '#ff8800';

    private epochsProcessed: number = 0;
    private lastProgressLog: number = 0;
    private readonly progressLogInterval: number = 5000; // Log every 5 seconds

    constructor(
        private readonly epochManager: EpochManager,
        private readonly progressTracker: IBDProgressTracker,
    ) {
        super();
    }

    /**
     * Run the epoch finalization phase
     * @param startHeight Starting block height
     * @param targetHeight Target block height (exclusive)
     * @param abortSignal Abort signal for cancellation
     */
    public async run(
        startHeight: bigint,
        targetHeight: bigint,
        abortSignal: AbortSignal,
    ): Promise<boolean> {
        this.info(`Epoch Finalization Phase: ${startHeight} -> ${targetHeight}`);
        this.epochsProcessed = 0;
        this.lastProgressLog = Date.now();

        // Calculate which epochs need to be finalized
        const epochsToFinalize = this.calculateEpochsToFinalize(startHeight, targetHeight);

        if (epochsToFinalize.length === 0) {
            this.info('No epochs to finalize');
            return true;
        }

        this.info(`Finalizing ${epochsToFinalize.length} epochs...`);

        // Initialize consensus if needed
        if (!OPNetConsensus.hasConsensus()) {
            OPNetConsensus.setBlockHeight(
                epochsToFinalize[0] * OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH,
            );
        }

        const totalEpochs = epochsToFinalize.length;

        for (const epoch of epochsToFinalize) {
            if (abortSignal.aborted) {
                this.warn('Epoch finalization aborted');
                return false;
            }

            try {
                await this.epochManager.finalizeEpochCompletion(epoch);
                this.epochsProcessed++;
            } catch (error) {
                this.warn(`Epoch ${epoch} finalization failed: ${error}`);
                // Continue with other epochs
            }

            // Log progress periodically
            this.logProgressIfNeeded(totalEpochs);

            // Save checkpoint periodically (every 100 epochs)
            if (this.epochsProcessed % 100 === 0) {
                const lastBlock = (epoch + 1n) * OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;
                await this.progressTracker.updateProgress(
                    IBDPhase.EPOCH_FINALIZATION,
                    lastBlock,
                    targetHeight,
                    { epochsFinalized: BigInt(this.epochsProcessed) },
                    true,
                );
            }
        }

        // Final checkpoint
        await this.progressTracker.updateProgress(
            IBDPhase.EPOCH_FINALIZATION,
            targetHeight - 1n,
            targetHeight,
            { epochsFinalized: BigInt(this.epochsProcessed) },
            true,
        );

        this.info(`Epoch finalization complete: ${this.epochsProcessed}/${totalEpochs} epochs finalized`);

        return true;
    }

    /**
     * Calculate which epochs need to be finalized for the given block range
     */
    private calculateEpochsToFinalize(startHeight: bigint, targetHeight: bigint): bigint[] {
        const blocksPerEpoch = OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;
        const epochs: bigint[] = [];

        // Find the first complete epoch in the range
        // An epoch N (blocks N*5 to N*5+4) is complete when we have block (N+1)*5
        let currentBlock = startHeight;

        while (currentBlock < targetHeight) {
            // Check if this block marks the completion of an epoch
            if (currentBlock % blocksPerEpoch === 0n && currentBlock > 0n) {
                const epochToFinalize = currentBlock / blocksPerEpoch - 1n;
                epochs.push(epochToFinalize);
            }
            currentBlock++;
        }

        // Sort epochs (should already be sorted, but ensure it)
        epochs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        return epochs;
    }

    /**
     * Log progress at intervals
     */
    private logProgressIfNeeded(totalEpochs: number): void {
        const now = Date.now();
        if (now - this.lastProgressLog < this.progressLogInterval) {
            return;
        }

        this.lastProgressLog = now;

        const percent = totalEpochs > 0 ? (this.epochsProcessed * 100) / totalEpochs : 0;

        this.info(
            `Epoch Finalization: ${this.epochsProcessed}/${totalEpochs} (${percent.toFixed(1)}%)`,
        );
    }
}
