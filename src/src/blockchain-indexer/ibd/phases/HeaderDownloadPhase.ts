/**
 * Header Download Phase
 * Downloads block headers in parallel using multiple workers
 */

import { Logger, DataConverter } from '@btc-vision/bsi-common';
import { BitcoinRPC, BlockHeaderInfo } from '@btc-vision/bitcoin-rpc';
import { Decimal128, Long } from 'mongodb';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';
import { BlockHeaderDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IBDProgressTracker } from '../IBDProgressTracker.js';
import { IBDPhase, IBDBlockRange } from '../interfaces/IBDState.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { ZERO_HASH } from '../../processor/block/types/ZeroValue.js';

interface HeaderDownloadConfig {
    batchSize: number;
    workerCount: number;
}

const DEFAULT_CONFIG: HeaderDownloadConfig = {
    batchSize: 100,
    workerCount: 12,
};

export class HeaderDownloadPhase extends Logger {
    public readonly logColor: string = '#00aaff';

    private readonly config: HeaderDownloadConfig;
    private blocksProcessed: bigint = 0n;
    private lastProgressLog: number = 0;
    private readonly progressLogInterval: number = 5000; // Log every 5 seconds

    /**
     * Callback to send messages to other threads
     */
    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    constructor(
        private readonly rpc: BitcoinRPC,
        private readonly blockRepository: BlockRepository,
        private readonly progressTracker: IBDProgressTracker,
        config?: Partial<HeaderDownloadConfig>,
    ) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Run the header download phase
     * @param startHeight Starting block height
     * @param targetHeight Target block height (exclusive - we download up to but not including)
     * @param abortSignal Abort signal for cancellation
     */
    public async run(
        startHeight: bigint,
        targetHeight: bigint,
        abortSignal: AbortSignal,
    ): Promise<boolean> {
        this.info(`Header Download Phase: ${startHeight} -> ${targetHeight}`);
        this.blocksProcessed = 0n;
        this.lastProgressLog = Date.now();

        const totalBlocks = targetHeight - startHeight;
        let currentHeight = startHeight;

        // Process in parallel batches
        while (currentHeight < targetHeight) {
            if (abortSignal.aborted) {
                this.warn('Header download aborted');
                return false;
            }

            // Calculate batch ranges for parallel download
            const batchRanges = this.calculateBatchRanges(
                currentHeight,
                targetHeight,
                this.config.batchSize,
                this.config.workerCount,
            );

            if (batchRanges.length === 0) break;

            // Download batches in parallel
            const results = await Promise.all(
                batchRanges.map((range) => this.downloadHeaderBatch(range, abortSignal)),
            );

            // Check for failures
            const failedBatch = results.find((r) => !r.success);
            if (failedBatch) {
                this.error(`Batch failed: ${failedBatch.error}`);
                return false;
            }

            // Update progress
            const lastRange = batchRanges[batchRanges.length - 1];
            currentHeight = lastRange.endHeight + 1n;
            this.blocksProcessed = currentHeight - startHeight;

            // Log progress periodically
            this.logProgressIfNeeded(currentHeight, targetHeight, totalBlocks);

            // Save checkpoint periodically
            if (this.progressTracker.shouldSaveCheckpoint(currentHeight)) {
                await this.progressTracker.updateProgress(
                    IBDPhase.HEADER_DOWNLOAD,
                    currentHeight,
                    targetHeight,
                    { headersDownloaded: this.blocksProcessed },
                    true,
                );
            }
        }

        // Final checkpoint - save targetHeight - 1 since that's the last header we actually downloaded
        // (targetHeight is exclusive)
        await this.progressTracker.updateProgress(
            IBDPhase.HEADER_DOWNLOAD,
            targetHeight - 1n,
            targetHeight,
            { headersDownloaded: this.blocksProcessed },
            true,
        );

        return true;
    }

    /**
     * Calculate batch ranges for parallel processing
     */
    private calculateBatchRanges(
        startHeight: bigint,
        targetHeight: bigint,
        batchSize: number,
        workerCount: number,
    ): IBDBlockRange[] {
        const ranges: IBDBlockRange[] = [];
        let current = startHeight;

        for (let i = 0; i < workerCount && current < targetHeight; i++) {
            const end = current + BigInt(batchSize) - 1n;
            const actualEnd = end < targetHeight ? end : targetHeight - 1n;

            ranges.push({
                startHeight: current,
                endHeight: actualEnd,
            });

            current = actualEnd + 1n;
        }

        return ranges;
    }

    /**
     * Download a batch of headers
     */
    private async downloadHeaderBatch(
        range: IBDBlockRange,
        abortSignal: AbortSignal,
    ): Promise<{ success: boolean; error?: string }> {
        try {
            if (abortSignal.aborted) {
                return { success: false, error: 'Aborted' };
            }

            // Get block hashes for the range
            const count = Number(range.endHeight - range.startHeight) + 1;
            const blockHashes = await this.rpc.getBlockHashes(Number(range.startHeight), count);

            if (!blockHashes || blockHashes.length === 0) {
                return { success: false, error: `No block hashes returned for range ${range.startHeight}-${range.endHeight}` };
            }

            // Filter out nulls and get headers
            const validHashes = blockHashes.filter((h): h is string => h !== null);
            if (validHashes.length === 0) {
                return { success: false, error: 'All block hashes were null' };
            }

            // Fetch block headers in batch with retry
            const headersWithHeights = await this.fetchBlockHeaders(validHashes, range.startHeight);

            if (abortSignal.aborted) {
                return { success: false, error: 'Aborted' };
            }

            if (headersWithHeights.length !== validHashes.length) {
                return {
                    success: false,
                    error: `Only fetched ${headersWithHeights.length}/${validHashes.length} headers for range ${range.startHeight}-${range.endHeight}`,
                };
            }

            // Convert to documents using actual heights (not index-based)
            const documents = headersWithHeights.map(({ header, height }) =>
                this.headerToDocument(header, height),
            );

            await this.blockRepository.saveBlockHeadersBatch(documents);

            return { success: true };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: err.message };
        }
    }

    /**
     * Fetch block headers for given hashes with retry logic
     */
    private async fetchBlockHeaders(
        hashes: string[],
        startHeight: bigint,
    ): Promise<{ header: BlockHeaderInfo; height: bigint }[]> {
        const results: { header: BlockHeaderInfo; height: bigint }[] = [];

        // Fetch headers with retry
        const promises = hashes.map(async (hash, idx) => {
            const height = startHeight + BigInt(idx);
            const header = await this.fetchHeaderWithRetry(hash, 3);
            if (header) {
                return { header, height };
            }
            return null;
        });

        const fetchResults = await Promise.all(promises);

        // Filter nulls and sort by height
        for (const result of fetchResults) {
            if (result) {
                results.push(result);
            }
        }

        results.sort((a, b) => (a.height < b.height ? -1 : a.height > b.height ? 1 : 0));

        return results;
    }

    /**
     * Fetch a single header with retry logic
     */
    private async fetchHeaderWithRetry(
        hash: string,
        maxRetries: number,
    ): Promise<BlockHeaderInfo | null> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const header = await this.rpc.getBlockHeader(hash);
                if (header) {
                    return header;
                }
            } catch (error) {
                lastError = error as Error;
                // Wait before retry with exponential backoff
                if (attempt < maxRetries - 1) {
                    await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
                }
            }
        }

        this.warn(`Failed to fetch header ${hash} after ${maxRetries} attempts: ${lastError?.message}`);
        return null;
    }

    /**
     * Convert BlockHeaderInfo to BlockHeaderDocument for storage
     * Note: Checksums are left empty - they'll be generated in Phase 2
     */
    private headerToDocument(header: BlockHeaderInfo, height: bigint): BlockHeaderDocument {
        return {
            height: DataConverter.toDecimal128(height),
            hash: header.hash,
            previousBlockHash: header.previousblockhash ?? null,
            merkleRoot: header.merkleroot,
            time: new Date(header.time * 1000),
            medianTime: new Date(header.mediantime * 1000),
            bits: header.bits,
            nonce: header.nonce,
            version: header.version,
            size: 0, // Will be updated with full block data
            weight: 0,
            strippedSize: 0,
            txCount: header.nTx || 0,

            // These will be populated in Phase 2 (checksum generation)
            checksumRoot: '',
            checksumProofs: [],
            previousBlockChecksum: '',

            // These will be populated when transactions are processed
            storageRoot: ZERO_HASH,
            receiptRoot: ZERO_HASH,

            // Gas fields - initialized to defaults
            ema: 0,
            baseGas: 0,
            gasUsed: Long.fromNumber(0),
        };
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

        const percent = totalBlocks > 0n
            ? (Number(this.blocksProcessed) * 100) / Number(totalBlocks)
            : 0;

        this.info(
            `Header Download: ${currentHeight}/${targetHeight} (${percent.toFixed(1)}%) - ` +
                `${this.blocksProcessed} headers downloaded`,
        );
    }
}
