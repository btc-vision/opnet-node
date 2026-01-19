/**
 * IBD Message Types and Interfaces
 * Defines the message structures for communication between IBD coordinator and workers
 */

import { IBDBlockRange } from './IBDState.js';
import { BlockHeaderDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';

/**
 * Message sent to worker to download headers
 */
export interface IBDDownloadHeadersMessage {
    /** Starting block height */
    startHeight: bigint;
    /** Number of headers to download */
    count: number;
}

/**
 * Response from worker after downloading headers
 */
export interface IBDDownloadHeadersResponse {
    /** Whether the download succeeded */
    success: boolean;
    /** Downloaded headers (minimal data for storage) */
    headers?: IBDHeaderData[];
    /** Block range that was processed */
    range: IBDBlockRange;
    /** Error message if failed */
    error?: string;
}

/**
 * Minimal header data needed for IBD storage
 */
export interface IBDHeaderData {
    height: bigint;
    hash: string;
    previousBlockHash: string;
    merkleRoot: string;
    time: number;
    medianTime: number;
    bits: string;
    nonce: number;
    version: number;
    size: number;
    weight: number;
    strippedSize: number;
    txCount: number;
}

/**
 * Message sent to SYNC thread to download and process transactions for IBD
 * Thread will download blocks, extract UTXOs, and save directly to MongoDB
 */
export interface IBDDownloadTransactionsMessage {
    /** Starting block height */
    startHeight: bigint;
    /** Ending block height (inclusive) */
    endHeight: bigint;
}

/**
 * Response from SYNC thread after downloading and processing transactions
 * UTXOs are saved directly to MongoDB by the thread - no data returned
 */
export interface IBDDownloadTransactionsResponse {
    /** Whether the download and save succeeded */
    success: boolean;
    /** Block range that was processed */
    range: IBDBlockRange;
    /** Number of blocks processed */
    blocksProcessed: number;
    /** Number of transactions processed */
    transactionsProcessed: number;
    /** Number of UTXOs saved */
    utxosSaved: number;
    /** Error message if failed */
    error?: string;
}

/**
 * Message to notify coordinator that a phase is complete
 */
export interface IBDPhaseCompleteMessage {
    /** The phase that completed */
    phase: string;
    /** Final statistics */
    stats: {
        blocksProcessed: bigint;
        timeElapsedMs: number;
    };
}

/**
 * Batch of headers ready for database insertion
 */
export interface IBDHeaderBatch {
    /** Headers to insert */
    headers: Partial<BlockHeaderDocument>[];
    /** Starting height of this batch */
    startHeight: bigint;
    /** Ending height of this batch */
    endHeight: bigint;
}

/**
 * Progress update from IBD
 */
export interface IBDProgressUpdate {
    /** Current phase */
    phase: string;
    /** Current progress in current phase (0-100) */
    progressPercent: number;
    /** Current height being processed */
    currentHeight: bigint;
    /** Target height */
    targetHeight: bigint;
    /** Blocks per second */
    blocksPerSecond: number;
    /** Estimated seconds remaining */
    estimatedSecondsRemaining: number;
}
