/**
 * Checksum Generation Phase
 * Generates checksums sequentially (each depends on previous)
 * This phase MUST be sequential because each block's checksum depends on the previous block's checksum
 *
 * This phase only generates checksums - epoch finalization happens in a later phase
 * after witnesses have been synced from P2P.
 */

import { Logger, DataConverter } from '@btc-vision/bsi-common';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';
import { IBlockHeaderBlockDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { IBDProgressTracker } from '../IBDProgressTracker.js';
import { IBDPhase } from '../interfaces/IBDState.js';
import { ChecksumMerkle } from '../../processor/block/merkle/ChecksumMerkle.js';
import { ReceiptMerkleTree } from '../../processor/block/merkle/ReceiptMerkleTree.js';
import { BTC_FAKE_ADDRESS, MAX_HASH, MAX_MINUS_ONE, ZERO_HASH } from '../../processor/block/types/ZeroValue.js';
import { EMPTY_STORAGE_ROOT } from '../../processor/block/types/EmptyTreeRoots.js';

interface ChecksumUpdate {
    height: bigint;
    checksumRoot: string;
    checksumProofs: Array<[number, string[]]>;
    previousBlockChecksum: string;
    storageRoot: string;
    receiptRoot: string;
}

export class ChecksumGenerationPhase extends Logger {
    public readonly logColor: string = '#ffaa00';

    private blocksProcessed: bigint = 0n;
    private lastProgressLog: number = 0;
    private readonly progressLogInterval: number = 5000; // Log every 5 seconds
    private readonly preloadBatchSize: number = 10000; // Preload headers in large batches
    private readonly dbWriteBatchSize: number = 2000; // Write checksums in batches

    // Previous block checksum for chain linking
    private previousBlockChecksum: string = ZERO_HASH;

    // Preloaded headers cache
    private headerCache: Map<bigint, IBlockHeaderBlockDocument> = new Map();
    private cacheStartHeight: bigint = 0n;
    private cacheEndHeight: bigint = 0n;

    constructor(
        private readonly blockRepository: BlockRepository,
        private readonly vmStorage: VMStorage,
        private readonly progressTracker: IBDProgressTracker,
    ) {
        super();
    }

    /**
     * Run the checksum generation phase
     * This must be sequential because each checksum depends on the previous
     * @param startHeight Starting block height
     * @param targetHeight Target block height (exclusive)
     * @param abortSignal Abort signal for cancellation
     */
    public async run(
        startHeight: bigint,
        targetHeight: bigint,
        abortSignal: AbortSignal,
    ): Promise<boolean> {
        this.info(`Checksum Generation Phase: ${startHeight} -> ${targetHeight}`);
        this.blocksProcessed = 0n;
        this.lastProgressLog = Date.now();

        const totalBlocks = targetHeight - startHeight;

        // Initialize previous checksum from the block before startHeight
        await this.initializePreviousChecksum(startHeight);

        // Clear cache
        this.headerCache.clear();
        this.cacheStartHeight = 0n;
        this.cacheEndHeight = 0n;

        let currentHeight = startHeight;
        let pendingUpdates: ChecksumUpdate[] = [];

        // Process blocks sequentially but with preloaded cache and batched writes
        while (currentHeight < targetHeight) {
            if (abortSignal.aborted) {
                this.warn('Checksum generation aborted');
                return false;
            }

            // Ensure we have headers in cache
            if (currentHeight >= this.cacheEndHeight || currentHeight < this.cacheStartHeight) {
                await this.preloadHeaders(currentHeight, targetHeight);
            }

            // Get header from cache
            const header = this.headerCache.get(currentHeight);
            if (!header) {
                this.error(`No header found in cache for height ${currentHeight}`);
                return false;
            }

            // Generate checksum (in memory, no DB write yet)
            const update = this.generateChecksum(header, currentHeight);
            pendingUpdates.push(update);

            // Update previous checksum for next iteration
            this.previousBlockChecksum = update.checksumRoot;

            this.blocksProcessed++;
            currentHeight++;

            // Batch write checksums to DB
            if (pendingUpdates.length >= this.dbWriteBatchSize) {
                await this.flushChecksumUpdates(pendingUpdates);
                pendingUpdates = [];
            }

            // Log progress periodically
            this.logProgressIfNeeded(currentHeight, targetHeight, totalBlocks);

            // Save checkpoint periodically
            if (this.progressTracker.shouldSaveCheckpoint(currentHeight)) {
                if (pendingUpdates.length > 0) {
                    await this.flushChecksumUpdates(pendingUpdates);
                    pendingUpdates = [];
                }
                await this.progressTracker.updateProgress(
                    IBDPhase.CHECKSUM_GENERATION,
                    currentHeight,
                    targetHeight,
                    { checksumsGenerated: this.blocksProcessed },
                    true,
                );
            }
        }

        // Flush remaining checksum updates
        if (pendingUpdates.length > 0) {
            await this.flushChecksumUpdates(pendingUpdates);
        }

        // Final checkpoint
        await this.progressTracker.updateProgress(
            IBDPhase.CHECKSUM_GENERATION,
            targetHeight - 1n,
            targetHeight,
            { checksumsGenerated: this.blocksProcessed },
            true,
        );

        // Clear cache
        this.headerCache.clear();

        this.info(`Checksum generation complete: ${this.blocksProcessed} checksums written to DB`);

        return true;
    }

    /**
     * Preload headers into cache
     */
    private async preloadHeaders(fromHeight: bigint, targetHeight: bigint): Promise<void> {
        const toHeight = fromHeight + BigInt(this.preloadBatchSize);
        const actualEnd = toHeight < targetHeight ? toHeight : targetHeight;

        this.debugBright(`Preloading headers ${fromHeight} -> ${actualEnd - 1n}`);

        // Clear old cache
        this.headerCache.clear();

        // Load headers
        const headers = await this.blockRepository.getBlockHeadersInRange(
            fromHeight,
            actualEnd - 1n,
        );

        if (headers.length === 0) {
            throw new Error(`No headers found for range ${fromHeight}-${actualEnd - 1n}`);
        }

        // Populate cache
        for (const header of headers) {
            const height = DataConverter.fromDecimal128(header.height);
            this.headerCache.set(height, header);
        }

        this.cacheStartHeight = fromHeight;
        this.cacheEndHeight = actualEnd;

        this.debugBright(`Preloaded ${headers.length} headers into cache`);
    }

    /**
     * Generate checksum for a block (in memory, no DB write)
     */
    private generateChecksum(
        header: IBlockHeaderBlockDocument,
        height: bigint,
    ): ChecksumUpdate {
        // Create checksum merkle tree
        const checksumMerkle = new ChecksumMerkle();

        // IBD only processes pre-OPNet blocks - these have NO OPNet transactions
        // So storageRoot is ALWAYS the empty tree root
        const storageRoot = EMPTY_STORAGE_ROOT;

        // Compute receiptRoot the same way VMManager.updateReceiptState() does:
        // 1. Add previous checksum (or empty buffer for first block)
        // 2. Add version byte
        // 3. Freeze the tree
        const receiptRoot = this.computeReceiptRoot();

        // Set block data for checksum calculation
        // ChecksumMerkle.setBlockData handles null/empty previousBlockHash internally
        checksumMerkle.setBlockData(
            header.previousBlockHash || ZERO_HASH,
            this.previousBlockChecksum,
            header.hash,
            header.merkleRoot,
            storageRoot,
            receiptRoot,
        );

        return {
            height,
            checksumRoot: checksumMerkle.root,
            checksumProofs: checksumMerkle.getProofs(),
            previousBlockChecksum: this.previousBlockChecksum,
            storageRoot,
            receiptRoot,
        };
    }

    /**
     * Compute receipt root matching VMManager.updateReceiptState() behavior
     */
    private computeReceiptRoot(): string {
        const receiptTree = new ReceiptMerkleTree();

        if (this.previousBlockChecksum && this.previousBlockChecksum !== ZERO_HASH) {
            const checksumBuffer = Buffer.from(this.previousBlockChecksum.replace('0x', ''), 'hex');
            if (checksumBuffer.length !== 32) {
                throw new Error('Invalid checksum length in IBD checksum generation.');
            }

            receiptTree.updateValue(BTC_FAKE_ADDRESS, MAX_HASH, checksumBuffer);
        } else {
            receiptTree.updateValue(BTC_FAKE_ADDRESS, MAX_HASH, Buffer.alloc(0));
        }

        receiptTree.updateValue(BTC_FAKE_ADDRESS, MAX_MINUS_ONE, Buffer.from([1]));
        receiptTree.freeze();

        return receiptTree.root;
    }

    /**
     * Flush pending checksum updates to database in batch
     */
    private async flushChecksumUpdates(updates: ChecksumUpdate[]): Promise<void> {
        if (updates.length === 0) return;

        await this.blockRepository.updateBlockChecksumBatch(updates);
    }

    /**
     * Initialize the previous block checksum from the block before start height
     */
    private async initializePreviousChecksum(startHeight: bigint): Promise<void> {
        if (startHeight <= 0n) {
            this.previousBlockChecksum = ZERO_HASH;
            return;
        }

        // Try to get the previous block's checksum
        const prevHeader = await this.vmStorage.getBlockHeader(startHeight - 1n);
        if (prevHeader && prevHeader.checksumRoot) {
            this.previousBlockChecksum = prevHeader.checksumRoot;
            this.info(`Initialized previous checksum from block ${startHeight - 1n}`);
        } else {
            this.previousBlockChecksum = ZERO_HASH;
            this.warn(
                `No previous checksum found for block ${startHeight - 1n}, using zero hash`,
            );
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
            `Checksum Generation: ${currentHeight}/${targetHeight} (${percent.toFixed(1)}%) - ` +
                `${this.blocksProcessed} checksums`,
        );
    }
}
