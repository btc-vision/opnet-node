/**
 * IBD (Initial Block Download) State Interfaces
 * Defines the state and checkpoint structures for parallel block download
 */

/**
 * IBD Phase identifiers
 */
export enum IBDPhase {
    /** Phase 1: Download block headers in parallel */
    HEADER_DOWNLOAD = 'HEADER_DOWNLOAD',
    /** Phase 2: Generate checksums sequentially (chain-dependent, only needs headers) */
    CHECKSUM_GENERATION = 'CHECKSUM_GENERATION',
    /** Phase 3: Download transactions and UTXOs in parallel */
    TRANSACTION_DOWNLOAD = 'TRANSACTION_DOWNLOAD',
    /** Phase 4: Sync witnesses from P2P peers (skipped by default) */
    WITNESS_SYNC = 'WITNESS_SYNC',
    /** Phase 5: Finalize epochs (after checksums are ready) */
    EPOCH_FINALIZATION = 'EPOCH_FINALIZATION',
    /** IBD complete, hand off to sequential processing */
    COMPLETE = 'COMPLETE',
}

/**
 * IBD Checkpoint document stored in MongoDB
 */
export interface IBDCheckpoint {
    /** Unique identifier for the checkpoint */
    _id: string;
    /** Current IBD phase */
    phase: IBDPhase;
    /** Original start height when IBD began */
    originalStartHeight: bigint;
    /** Last successfully completed block height in current phase */
    lastCompletedHeight: bigint;
    /** Target height (OPNet activation block) */
    targetHeight: bigint;
    /** When this checkpoint was created/updated */
    timestamp: Date;
    /** Additional phase-specific metadata */
    metadata?: IBDPhaseMetadata;
}

/**
 * Phase-specific metadata for checkpoints
 */
export interface IBDPhaseMetadata {
    /** For header download: ranges that have been completed */
    completedRanges?: IBDBlockRange[];
    /** For checksum: last epoch that was finalized */
    lastFinalizedEpoch?: bigint;
    /** For transaction download: ranges that have been completed */
    transactionRanges?: IBDBlockRange[];
}

/**
 * Represents a range of blocks
 */
export interface IBDBlockRange {
    startHeight: bigint;
    endHeight: bigint;
}

/**
 * Current IBD state in memory
 */
export interface IBDState {
    /** Whether IBD mode is active */
    isActive: boolean;
    /** Current phase */
    phase: IBDPhase;
    /** Start height for IBD */
    startHeight: bigint;
    /** Target height (OPNet activation block) */
    targetHeight: bigint;
    /** Currently processed height in current phase */
    currentHeight: bigint;
    /** Whether IBD was interrupted and is resuming */
    isResuming: boolean;
    /** Start time of current IBD session */
    startTime: Date;
    /** Progress statistics */
    stats: IBDStats;
}

/**
 * IBD progress statistics
 */
export interface IBDStats {
    /** Total blocks to process */
    totalBlocks: bigint;
    /** Blocks processed in current phase */
    blocksProcessed: bigint;
    /** Headers downloaded */
    headersDownloaded: bigint;
    /** Checksums generated */
    checksumsGenerated: bigint;
    /** Transactions downloaded */
    transactionsDownloaded: bigint;
    /** UTXOs saved to database */
    utxosSaved: bigint;
    /** Witnesses received from P2P */
    witnessesReceived: bigint;
    /** Epochs finalized */
    epochsFinalized: bigint;
    /** Current blocks per second rate */
    blocksPerSecond: number;
    /** Estimated time remaining in seconds */
    estimatedSecondsRemaining: number;
}

/**
 * Worker task assignment for parallel processing
 */
export interface IBDWorkerTask {
    /** Worker ID (0-11 for 12 workers) */
    workerId: number;
    /** Starting block height for this task */
    startHeight: bigint;
    /** Ending block height for this task (inclusive) */
    endHeight: bigint;
    /** Task type */
    taskType: IBDPhase.HEADER_DOWNLOAD | IBDPhase.TRANSACTION_DOWNLOAD;
}

/**
 * Result from a worker task
 */
export interface IBDWorkerResult {
    /** Worker ID */
    workerId: number;
    /** Whether the task succeeded */
    success: boolean;
    /** Block range that was processed */
    range: IBDBlockRange;
    /** Number of items processed */
    itemsProcessed: number;
    /** Error message if failed */
    error?: string;
}

/**
 * Configuration for IBD
 */
export interface IBDConfig {
    /** Whether IBD is enabled */
    ENABLED: boolean;
    /** Number of headers to fetch per batch */
    HEADER_BATCH_SIZE: number;
    /** Number of transactions to fetch per batch */
    TRANSACTION_BATCH_SIZE: number;
    /** Minimum blocks behind to trigger IBD mode */
    IBD_THRESHOLD: number;
    /** How often to save checkpoints (in blocks) */
    CHECKPOINT_INTERVAL: number;
    /** Number of parallel workers to use */
    WORKER_COUNT: number;
}

/**
 * Default IBD configuration
 */
export const DEFAULT_IBD_CONFIG: IBDConfig = {
    ENABLED: true,
    HEADER_BATCH_SIZE: 100,
    TRANSACTION_BATCH_SIZE: 5,
    IBD_THRESHOLD: 1000,
    CHECKPOINT_INTERVAL: 1000,
    WORKER_COUNT: 12,
};
