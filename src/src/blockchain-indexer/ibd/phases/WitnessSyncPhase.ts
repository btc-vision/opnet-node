/**
 * Witness Sync Phase
 * Syncs block witnesses from P2P peers before epoch finalization
 * This phase requests witnesses for each block that needs them for epoch generation
 */

import { Logger } from '@btc-vision/bsi-common';
import { IBDProgressTracker } from '../IBDProgressTracker.js';
import { IBDPhase } from '../interfaces/IBDState.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';

export interface WitnessSyncResult {
    blockNumber: bigint;
    witnessCount: number;
    success: boolean;
}

export type RequestWitnessesCallback = (blockNumber: bigint) => Promise<WitnessSyncResult>;

export class WitnessSyncPhase extends Logger {
    public readonly logColor: string = '#00ff88';

    private blocksProcessed: bigint = 0n;
    private witnessesReceived: bigint = 0n;
    private lastProgressLog: number = 0;
    private readonly progressLogInterval: number = 5000; // Log every 5 seconds
    private readonly batchSize: number = 100; // Request witnesses in batches

    constructor(
        private readonly progressTracker: IBDProgressTracker,
        private readonly requestWitnesses: RequestWitnessesCallback,
    ) {
        super();
    }

    /**
     * Run the witness sync phase
     * Requests witnesses for all blocks in the range
     * @param startHeight Starting block height
     * @param targetHeight Target block height (exclusive)
     * @param abortSignal Abort signal for cancellation
     */
    public async run(
        startHeight: bigint,
        targetHeight: bigint,
        abortSignal: AbortSignal,
    ): Promise<boolean> {
        this.info(`Witness Sync Phase: ${startHeight} -> ${targetHeight}`);
        this.blocksProcessed = 0n;
        this.witnessesReceived = 0n;
        this.lastProgressLog = Date.now();

        const totalBlocks = targetHeight - startHeight;

        // We only need witnesses for blocks that are part of epochs
        // Epochs are finalized at block boundaries (5, 10, 15, etc.)
        // We need witnesses for all blocks to build proper epoch merkle trees

        let currentHeight = startHeight;

        while (currentHeight < targetHeight) {
            if (abortSignal.aborted) {
                this.warn('Witness sync aborted');
                return false;
            }

            // Process in batches for efficiency
            const batchEnd = currentHeight + BigInt(this.batchSize);
            const actualEnd = batchEnd < targetHeight ? batchEnd : targetHeight;

            // Request witnesses for this batch
            const results = await this.syncWitnessBatch(currentHeight, actualEnd, abortSignal);

            if (!results) {
                // Batch failed or aborted
                return false;
            }

            // Update counters
            for (const result of results) {
                if (result.success) {
                    this.witnessesReceived += BigInt(result.witnessCount);
                }
                this.blocksProcessed++;
            }

            currentHeight = actualEnd;

            // Log progress periodically
            this.logProgressIfNeeded(currentHeight, targetHeight, totalBlocks);

            // Save checkpoint periodically
            if (this.progressTracker.shouldSaveCheckpoint(currentHeight)) {
                await this.progressTracker.updateProgress(
                    IBDPhase.WITNESS_SYNC,
                    currentHeight,
                    targetHeight,
                    {
                        blocksProcessed: this.blocksProcessed,
                        witnessesReceived: this.witnessesReceived,
                    },
                    true,
                );
            }
        }

        // Final checkpoint
        await this.progressTracker.updateProgress(
            IBDPhase.WITNESS_SYNC,
            targetHeight - 1n,
            targetHeight,
            {
                blocksProcessed: this.blocksProcessed,
                witnessesReceived: this.witnessesReceived,
            },
            true,
        );

        this.info(
            `Witness sync complete: ${this.blocksProcessed} blocks, ${this.witnessesReceived} witnesses`,
        );

        return true;
    }

    /**
     * Sync witnesses for a batch of blocks
     */
    private async syncWitnessBatch(
        startHeight: bigint,
        endHeight: bigint,
        abortSignal: AbortSignal,
    ): Promise<WitnessSyncResult[] | null> {
        const results: WitnessSyncResult[] = [];

        // Request witnesses for each block in the batch
        // We could parallelize this, but P2P requests need to be paced
        for (let height = startHeight; height < endHeight; height++) {
            if (abortSignal.aborted) {
                return null;
            }

            try {
                const result = await this.requestWitnesses(height);
                results.push(result);
            } catch (error) {
                // Log but continue - some blocks may not have witnesses
                this.debug(`Failed to sync witnesses for block ${height}: ${error}`);
                results.push({
                    blockNumber: height,
                    witnessCount: 0,
                    success: false,
                });
            }
        }

        return results;
    }

    /**
     * Log progress at intervals
     */
    private logProgressIfNeeded(
        currentHeight: bigint,
        targetHeight: bigint,
        totalBlocks: bigint,
    ): void {
        const now = Date.now();
        if (now - this.lastProgressLog < this.progressLogInterval) {
            return;
        }

        this.lastProgressLog = now;

        const percent =
            totalBlocks > 0n ? (Number(this.blocksProcessed) * 100) / Number(totalBlocks) : 0;

        this.info(
            `Witness Sync: ${currentHeight}/${targetHeight} (${percent.toFixed(1)}%) - ` +
                `${this.blocksProcessed} blocks, ${this.witnessesReceived} witnesses`,
        );
    }
}
