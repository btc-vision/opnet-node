/**
 * IBD Progress Tracker
 * Handles checkpoint persistence and resume functionality for IBD
 */

import { Logger, DataConverter } from '@btc-vision/bsi-common';
import { Collection, Db, Decimal128 } from 'mongodb';
import {
    IBDCheckpoint,
    IBDPhase,
    IBDPhaseMetadata,
    IBDStats,
    IBDState,
} from './interfaces/IBDState.js';

/**
 * MongoDB document for IBD checkpoint
 */
interface IBDCheckpointDocument {
    _id: string;
    phase: string;
    originalStartHeight: Decimal128;
    lastCompletedHeight: Decimal128;
    targetHeight: Decimal128;
    timestamp: Date;
    metadata?: {
        completedRanges?: Array<{
            startHeight: Decimal128;
            endHeight: Decimal128;
        }>;
        lastFinalizedEpoch?: Decimal128;
        transactionRanges?: Array<{
            startHeight: Decimal128;
            endHeight: Decimal128;
        }>;
    };
}

const IBD_CHECKPOINT_ID = 'ibd_checkpoint';
const IBD_CHECKPOINTS_COLLECTION = 'IBDCheckpoints';

export class IBDProgressTracker extends Logger {
    public readonly logColor: string = '#ffaa00';

    private collection: Collection<IBDCheckpointDocument> | undefined;
    private currentState: IBDState | undefined;
    private originalStartHeight: bigint = 0n;
    private lastCheckpointSave: number = 0;
    private readonly checkpointInterval: number;

    constructor(
        private readonly db: Db,
        checkpointIntervalBlocks: number = 1000,
    ) {
        super();
        this.checkpointInterval = checkpointIntervalBlocks;
    }

    /**
     * Initialize the progress tracker
     */
    public init(): void {
        this.collection = this.db.collection<IBDCheckpointDocument>(IBD_CHECKPOINTS_COLLECTION);
        // _id already has a unique index by default in MongoDB
    }

    /**
     * Check if there's an existing checkpoint to resume from
     */
    public async hasCheckpoint(): Promise<boolean> {
        const checkpoint = await this.loadCheckpoint();
        return checkpoint !== null && checkpoint.phase !== IBDPhase.COMPLETE;
    }

    /**
     * Load existing checkpoint from database
     */
    public async loadCheckpoint(): Promise<IBDCheckpoint | null> {
        if (!this.collection) {
            throw new Error('IBDProgressTracker not initialized');
        }

        const doc = await this.collection.findOne({ _id: IBD_CHECKPOINT_ID });
        if (!doc) {
            return null;
        }

        return this.documentToCheckpoint(doc);
    }

    /**
     * Create initial IBD state for fresh sync
     */
    public createInitialState(startHeight: bigint, targetHeight: bigint): IBDState {
        this.originalStartHeight = startHeight;

        this.currentState = {
            isActive: true,
            phase: IBDPhase.HEADER_DOWNLOAD,
            startHeight,
            targetHeight,
            currentHeight: startHeight,
            isResuming: false,
            startTime: new Date(),
            stats: {
                totalBlocks: targetHeight - startHeight,
                blocksProcessed: 0n,
                headersDownloaded: 0n,
                checksumsGenerated: 0n,
                transactionsDownloaded: 0n,
                utxosSaved: 0n,
                witnessesReceived: 0n,
                epochsFinalized: 0n,
                blocksPerSecond: 0,
                estimatedSecondsRemaining: 0,
            },
        };

        return this.currentState;
    }

    /**
     * Create IBD state from existing checkpoint (resume)
     */
    public createStateFromCheckpoint(checkpoint: IBDCheckpoint): IBDState {
        // Use originalStartHeight for startHeight (needed for checksum phase)
        // Use lastCompletedHeight for currentHeight (where to resume)
        this.originalStartHeight = checkpoint.originalStartHeight;

        const totalBlocks = checkpoint.targetHeight - checkpoint.lastCompletedHeight;

        this.currentState = {
            isActive: true,
            phase: checkpoint.phase,
            startHeight: checkpoint.originalStartHeight,
            targetHeight: checkpoint.targetHeight,
            currentHeight: checkpoint.lastCompletedHeight,
            isResuming: true,
            startTime: new Date(),
            stats: {
                totalBlocks,
                blocksProcessed: 0n,
                headersDownloaded: 0n,
                checksumsGenerated: 0n,
                transactionsDownloaded: 0n,
                utxosSaved: 0n,
                witnessesReceived: 0n,
                epochsFinalized: 0n,
                blocksPerSecond: 0,
                estimatedSecondsRemaining: 0,
            },
        };

        this.info(
            `Resuming IBD from checkpoint: phase=${checkpoint.phase}, ` +
            `originalStart=${checkpoint.originalStartHeight}, resumeAt=${checkpoint.lastCompletedHeight}`,
        );

        return this.currentState;
    }

    /**
     * Save checkpoint to database
     */
    public async saveCheckpoint(
        phase: IBDPhase,
        lastCompletedHeight: bigint,
        targetHeight: bigint,
        metadata?: IBDPhaseMetadata,
    ): Promise<void> {
        if (!this.collection) {
            throw new Error('IBDProgressTracker not initialized');
        }

        const doc: IBDCheckpointDocument = {
            _id: IBD_CHECKPOINT_ID,
            phase,
            originalStartHeight: DataConverter.toDecimal128(this.originalStartHeight),
            lastCompletedHeight: DataConverter.toDecimal128(lastCompletedHeight),
            targetHeight: DataConverter.toDecimal128(targetHeight),
            timestamp: new Date(),
            metadata: metadata
                ? {
                      completedRanges: metadata.completedRanges?.map((r) => ({
                          startHeight: DataConverter.toDecimal128(r.startHeight),
                          endHeight: DataConverter.toDecimal128(r.endHeight),
                      })),
                      lastFinalizedEpoch: metadata.lastFinalizedEpoch
                          ? DataConverter.toDecimal128(metadata.lastFinalizedEpoch)
                          : undefined,
                      transactionRanges: metadata.transactionRanges?.map((r) => ({
                          startHeight: DataConverter.toDecimal128(r.startHeight),
                          endHeight: DataConverter.toDecimal128(r.endHeight),
                      })),
                  }
                : undefined,
        };

        await this.collection.updateOne({ _id: IBD_CHECKPOINT_ID }, { $set: doc }, { upsert: true });

        this.lastCheckpointSave = Number(lastCompletedHeight);
        this.log(
            `Checkpoint saved: phase=${phase}, height=${lastCompletedHeight}/${targetHeight}`,
        );
    }

    /**
     * Check if we should save a checkpoint based on blocks processed
     */
    public shouldSaveCheckpoint(currentHeight: bigint): boolean {
        const heightNum = Number(currentHeight);
        return heightNum - this.lastCheckpointSave >= this.checkpointInterval;
    }

    /**
     * Update current state and optionally save checkpoint
     */
    public async updateProgress(
        phase: IBDPhase,
        currentHeight: bigint,
        targetHeight: bigint,
        stats: Partial<IBDStats>,
        forceSave: boolean = false,
    ): Promise<void> {
        if (!this.currentState) {
            throw new Error('IBD state not initialized');
        }

        // Update in-memory state
        this.currentState.phase = phase;
        this.currentState.currentHeight = currentHeight;
        Object.assign(this.currentState.stats, stats);

        // Calculate blocks per second and ETA
        const elapsedMs = Date.now() - this.currentState.startTime.getTime();
        const elapsedSec = elapsedMs / 1000;
        if (elapsedSec > 0 && this.currentState.stats.blocksProcessed > 0n) {
            this.currentState.stats.blocksPerSecond =
                Number(this.currentState.stats.blocksProcessed) / elapsedSec;

            const remainingBlocks = targetHeight - currentHeight;
            if (this.currentState.stats.blocksPerSecond > 0) {
                this.currentState.stats.estimatedSecondsRemaining =
                    Number(remainingBlocks) / this.currentState.stats.blocksPerSecond;
            }
        }

        // Save checkpoint if needed
        if (forceSave || this.shouldSaveCheckpoint(currentHeight)) {
            await this.saveCheckpoint(phase, currentHeight, targetHeight);
        }
    }

    /**
     * Mark IBD as complete and clear checkpoint
     */
    public async markComplete(): Promise<void> {
        if (!this.collection) {
            throw new Error('IBDProgressTracker not initialized');
        }

        if (this.currentState) {
            this.currentState.isActive = false;
            this.currentState.phase = IBDPhase.COMPLETE;
        }

        // Update checkpoint to COMPLETE status (for logging/auditing)
        await this.collection.updateOne(
            { _id: IBD_CHECKPOINT_ID },
            {
                $set: {
                    phase: IBDPhase.COMPLETE,
                    timestamp: new Date(),
                },
            },
        );

        this.success('IBD completed successfully');
    }

    /**
     * Clear checkpoint entirely (for fresh start)
     */
    public async clearCheckpoint(): Promise<void> {
        if (!this.collection) {
            throw new Error('IBDProgressTracker not initialized');
        }

        await this.collection.deleteOne({ _id: IBD_CHECKPOINT_ID });
        this.currentState = undefined;
        this.lastCheckpointSave = 0;

        this.log('IBD checkpoint cleared');
    }

    /**
     * Get current IBD state
     */
    public getState(): IBDState | undefined {
        return this.currentState;
    }

    /**
     * Get progress percentage for current phase
     */
    public getProgressPercent(): number {
        if (!this.currentState) return 0;

        const { startHeight, currentHeight, targetHeight } = this.currentState;
        const total = targetHeight - startHeight;
        if (total <= 0n) return 100;

        const processed = currentHeight - startHeight;
        return Number((processed * 100n) / total);
    }

    /**
     * Log current progress
     */
    public logProgress(): void {
        if (!this.currentState) return;

        const { phase, currentHeight, targetHeight, stats } = this.currentState;
        const percent = this.getProgressPercent();
        const eta = stats.estimatedSecondsRemaining;
        const etaStr =
            eta > 0
                ? `ETA: ${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`
                : 'calculating...';

        this.info(
            `IBD Progress [${phase}]: ${currentHeight}/${targetHeight} (${percent.toFixed(1)}%) - ` +
                `${stats.blocksPerSecond.toFixed(1)} blocks/s - ${etaStr}`,
        );
    }

    /**
     * Convert MongoDB document to checkpoint interface
     */
    private documentToCheckpoint(doc: IBDCheckpointDocument): IBDCheckpoint {
        return {
            _id: doc._id,
            phase: doc.phase as IBDPhase,
            originalStartHeight: doc.originalStartHeight
                ? DataConverter.fromDecimal128(doc.originalStartHeight)
                : 0n,
            lastCompletedHeight: DataConverter.fromDecimal128(doc.lastCompletedHeight),
            targetHeight: DataConverter.fromDecimal128(doc.targetHeight),
            timestamp: doc.timestamp,
            metadata: doc.metadata
                ? {
                      completedRanges: doc.metadata.completedRanges?.map((r) => ({
                          startHeight: DataConverter.fromDecimal128(r.startHeight),
                          endHeight: DataConverter.fromDecimal128(r.endHeight),
                      })),
                      lastFinalizedEpoch: doc.metadata.lastFinalizedEpoch
                          ? DataConverter.fromDecimal128(doc.metadata.lastFinalizedEpoch)
                          : undefined,
                      transactionRanges: doc.metadata.transactionRanges?.map((r) => ({
                          startHeight: DataConverter.fromDecimal128(r.startHeight),
                          endHeight: DataConverter.fromDecimal128(r.endHeight),
                      })),
                  }
                : undefined,
        };
    }
}
