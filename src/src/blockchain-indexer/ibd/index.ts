/**
 * IBD (Initial Block Download) Module
 * Exports all IBD-related components for faster initial sync
 */

export { IBDCoordinator } from './IBDCoordinator.js';
export type { IBDDetectionResult } from './IBDCoordinator.js';

export { IBDProgressTracker } from './IBDProgressTracker.js';

export {
    IBDPhase,
    DEFAULT_IBD_CONFIG,
} from './interfaces/IBDState.js';
export type {
    IBDCheckpoint,
    IBDPhaseMetadata,
    IBDBlockRange,
    IBDState,
    IBDStats,
    IBDWorkerTask,
    IBDWorkerResult,
    IBDConfig,
} from './interfaces/IBDState.js';

export type {
    IBDDownloadHeadersMessage,
    IBDDownloadHeadersResponse,
    IBDHeaderData,
    IBDDownloadTransactionsMessage,
    IBDDownloadTransactionsResponse,
    IBDPhaseCompleteMessage,
    IBDHeaderBatch,
    IBDProgressUpdate,
} from './interfaces/IBDMessages.js';

export { HeaderDownloadPhase } from './phases/HeaderDownloadPhase.js';
export { ChecksumGenerationPhase } from './phases/ChecksumGenerationPhase.js';
export { WitnessSyncPhase } from './phases/WitnessSyncPhase.js';
export type { WitnessSyncResult, RequestWitnessesCallback } from './phases/WitnessSyncPhase.js';
export { EpochFinalizationPhase } from './phases/EpochFinalizationPhase.js';
export { TransactionDownloadPhase } from './phases/TransactionDownloadPhase.js';
