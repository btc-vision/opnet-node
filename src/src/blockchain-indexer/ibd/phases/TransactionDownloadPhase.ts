/**
 * Transaction Download Phase
 * Downloads full block data with transactions using SYNC worker threads
 * Each thread downloads blocks, extracts UTXOs, and saves directly to MongoDB
 * Blocks are processed in order within each thread to maintain UTXO ordering
 */

import { Logger } from '@btc-vision/bsi-common';
import { IBDProgressTracker } from '../IBDProgressTracker.js';
import { IBDPhase, IBDBlockRange } from '../interfaces/IBDState.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import {
    IBDDownloadTransactionsMessage,
    IBDDownloadTransactionsResponse,
} from '../interfaces/IBDMessages.js';

interface TransactionDownloadConfig {
    batchSize: number;
    workerCount: number;
}

const DEFAULT_CONFIG: TransactionDownloadConfig = {
    batchSize: 5, // Smaller batches to avoid DB timeouts
    workerCount: 12,
};

export class TransactionDownloadPhase extends Logger {
    public readonly logColor: string = '#ff00aa';

    private readonly config: TransactionDownloadConfig;
    private blocksProcessed: bigint = 0n;
    private transactionsProcessed: bigint = 0n;
    private utxosSaved: bigint = 0n;
    private lastProgressLog: number = 0;
    private readonly progressLogInterval: number = 5000; // Log every 5 seconds

    /**
     * Callback to send messages to worker threads
     */
    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    constructor(
        private readonly progressTracker: IBDProgressTracker,
        config?: Partial<TransactionDownloadConfig>,
    ) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Run the transaction download phase using SYNC worker threads
     * @param startHeight Starting block height
     * @param targetHeight Target block height (exclusive)
     * @param abortSignal Abort signal for cancellation
     */
    public async run(
        startHeight: bigint,
        targetHeight: bigint,
        abortSignal: AbortSignal,
    ): Promise<boolean> {
        this.info(`Transaction Download Phase: ${startHeight} -> ${targetHeight}`);
        this.blocksProcessed = 0n;
        this.transactionsProcessed = 0n;
        this.utxosSaved = 0n;
        this.lastProgressLog = Date.now();

        const totalBlocks = targetHeight - startHeight;
        let currentHeight = startHeight;

        // Process in rounds, dispatching work to all 12 threads
        while (currentHeight < targetHeight) {
            if (abortSignal.aborted) {
                this.warn('Transaction download aborted');
                return false;
            }

            // Calculate ranges for each thread
            // Each thread gets batchSize blocks, threads work in parallel
            const threadRanges = this.calculateThreadRanges(
                currentHeight,
                targetHeight,
                this.config.batchSize,
                this.config.workerCount,
            );

            if (threadRanges.length === 0) break;

            // Dispatch work to all threads in parallel
            const promises = threadRanges.map((range) =>
                this.dispatchToThread(range, abortSignal),
            );

            // Wait for all threads to complete this round
            const results = await Promise.all(promises);

            // Check for failures
            for (const result of results) {
                if (!result.success) {
                    this.error(`Thread failed: ${result.error}`);
                    return false;
                }

                // Aggregate stats
                this.transactionsProcessed += BigInt(result.transactionsProcessed);
                this.utxosSaved += BigInt(result.utxosSaved);
            }

            // Update current height to after all processed ranges
            const lastRange = threadRanges[threadRanges.length - 1];
            currentHeight = lastRange.endHeight + 1n;
            this.blocksProcessed = currentHeight - startHeight;

            // Log progress periodically
            this.logProgressIfNeeded(currentHeight, targetHeight, totalBlocks);

            // Save checkpoint periodically
            if (this.progressTracker.shouldSaveCheckpoint(currentHeight)) {
                await this.progressTracker.updateProgress(
                    IBDPhase.TRANSACTION_DOWNLOAD,
                    currentHeight,
                    targetHeight,
                    {
                        transactionsDownloaded: this.transactionsProcessed,
                        blocksProcessed: this.blocksProcessed,
                        utxosSaved: this.utxosSaved,
                    },
                    true,
                );
            }
        }

        // Final checkpoint
        await this.progressTracker.updateProgress(
            IBDPhase.TRANSACTION_DOWNLOAD,
            targetHeight - 1n,
            targetHeight,
            {
                transactionsDownloaded: this.transactionsProcessed,
                blocksProcessed: this.blocksProcessed,
                utxosSaved: this.utxosSaved,
            },
            true,
        );

        this.success(
            `Transaction Download complete: ${this.blocksProcessed} blocks, ` +
                `${this.transactionsProcessed} txs, ${this.utxosSaved} UTXOs saved`,
        );

        return true;
    }

    /**
     * Calculate block ranges for each thread
     * Each thread gets a contiguous range of blocks to process in order
     */
    private calculateThreadRanges(
        startHeight: bigint,
        targetHeight: bigint,
        batchSize: number,
        workerCount: number,
    ): IBDBlockRange[] {
        const ranges: IBDBlockRange[] = [];
        let current = startHeight;

        for (let i = 0; i < workerCount && current < targetHeight; i++) {
            const end = current + BigInt(batchSize) - 1n;
            const actualEnd = end < targetHeight - 1n ? end : targetHeight - 1n;

            ranges.push({
                startHeight: current,
                endHeight: actualEnd,
            });

            current = actualEnd + 1n;
        }

        return ranges;
    }

    /**
     * Dispatch a block range to a SYNC thread for processing
     */
    private async dispatchToThread(
        range: IBDBlockRange,
        abortSignal: AbortSignal,
    ): Promise<IBDDownloadTransactionsResponse> {
        if (abortSignal.aborted) {
            return {
                success: false,
                range,
                blocksProcessed: 0,
                transactionsProcessed: 0,
                utxosSaved: 0,
                error: 'Aborted',
            };
        }

        try {
            const message: ThreadMessageBase<MessageType> = {
                type: MessageType.IBD_DOWNLOAD_TRANSACTIONS,
                data: {
                    startHeight: range.startHeight,
                    endHeight: range.endHeight,
                } as IBDDownloadTransactionsMessage,
            };

            const result = await this.sendMessageToThread(
                ThreadTypes.SYNCHRONISATION,
                message,
            );

            if (!result) {
                return {
                    success: false,
                    range,
                    blocksProcessed: 0,
                    transactionsProcessed: 0,
                    utxosSaved: 0,
                    error: 'No response from thread',
                };
            }

            // The result is the IBDDownloadTransactionsResponse
            return result as IBDDownloadTransactionsResponse;
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                range,
                blocksProcessed: 0,
                transactionsProcessed: 0,
                utxosSaved: 0,
                error: err.message,
            };
        }
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
            `Transaction Download: ${currentHeight}/${targetHeight} (${percent.toFixed(1)}%) - ` +
                `${this.blocksProcessed} blocks, ${this.transactionsProcessed} txs, ${this.utxosSaved} UTXOs`,
        );
    }
}
