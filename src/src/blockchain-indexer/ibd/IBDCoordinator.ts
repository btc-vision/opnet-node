/**
 * IBD (Initial Block Download) Coordinator
 * Main orchestrator for parallel block download before OPNet activation
 *
 * Phase order:
 * 1. Header Download - Download block headers in parallel
 * 2. Checksum Generation - Generate checksums sequentially (chain-dependent, only needs headers)
 * 3. Transaction Download - Download full block data in parallel
 * 4. Witness Sync - Sync block witnesses from P2P peers (skipped by default)
 * 5. Epoch Finalization - Finalize epochs (needs checksums)
 */

import { Logger } from '@btc-vision/bsi-common';
import { Db } from 'mongodb';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { IBDProgressTracker } from './IBDProgressTracker.js';
import {
    IBDPhase,
    IBDState,
    IBDConfig,
    DEFAULT_IBD_CONFIG,
    IBDCheckpoint,
} from './interfaces/IBDState.js';
import { HeaderDownloadPhase } from './phases/HeaderDownloadPhase.js';
import { ChecksumGenerationPhase } from './phases/ChecksumGenerationPhase.js';
import { TransactionDownloadPhase } from './phases/TransactionDownloadPhase.js';
import { WitnessSyncPhase, RequestWitnessesCallback } from './phases/WitnessSyncPhase.js';
import { EpochFinalizationPhase } from './phases/EpochFinalizationPhase.js';
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';
import { Config } from '../../config/Config.js';
import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';
import { BlockRepository } from '../../db/repositories/BlockRepository.js';
import { EpochManager } from '../processor/epoch/EpochManager.js';

/**
 * Result of IBD detection
 */
export interface IBDDetectionResult {
    shouldUseIBD: boolean;
    startHeight: bigint;
    targetHeight: bigint;
    reason: string;
}

export class IBDCoordinator extends Logger {
    public readonly logColor: string = '#00ff88';

    private readonly progressTracker: IBDProgressTracker;
    private readonly config: IBDConfig;

    private headerPhase: HeaderDownloadPhase | undefined;
    private transactionPhase: TransactionDownloadPhase | undefined;
    private checksumPhase: ChecksumGenerationPhase | undefined;
    private witnessSyncPhase: WitnessSyncPhase | undefined;
    private epochFinalizationPhase: EpochFinalizationPhase | undefined;

    private isRunning: boolean = false;
    private abortController: AbortController = new AbortController();

    /**
     * Callback to send messages to other threads
     */
    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    /**
     * Callback to request witnesses from P2P for a block
     * Must be set by the caller before running IBD
     */
    public requestWitnesses: RequestWitnessesCallback = () => {
        // Default implementation - no witnesses available
        return Promise.resolve({ blockNumber: 0n, witnessCount: 0, success: false });
    };

    constructor(
        private readonly db: Db,
        private readonly rpc: BitcoinRPC,
        private readonly vmStorage: VMStorage,
        private readonly blockRepository: BlockRepository,
        private readonly epochManager: EpochManager,
        config?: Partial<IBDConfig>,
    ) {
        super();

        // Merge provided config with defaults
        this.config = { ...DEFAULT_IBD_CONFIG, ...config };

        // Use config from Config.OP_NET.IBD if available
        if (Config.OP_NET.IBD) {
            this.config.ENABLED = Config.OP_NET.IBD.ENABLED ?? this.config.ENABLED;
            this.config.HEADER_BATCH_SIZE =
                Config.OP_NET.IBD.HEADER_BATCH_SIZE ?? this.config.HEADER_BATCH_SIZE;
            this.config.TRANSACTION_BATCH_SIZE =
                Config.OP_NET.IBD.TRANSACTION_BATCH_SIZE ?? this.config.TRANSACTION_BATCH_SIZE;
            this.config.IBD_THRESHOLD = Config.OP_NET.IBD.IBD_THRESHOLD ?? this.config.IBD_THRESHOLD;
            this.config.CHECKPOINT_INTERVAL =
                Config.OP_NET.IBD.CHECKPOINT_INTERVAL ?? this.config.CHECKPOINT_INTERVAL;
            this.config.WORKER_COUNT = Config.OP_NET.IBD.WORKER_COUNT ?? this.config.WORKER_COUNT;
        }

        this.info(
            `IBD Config: batchSize=${this.config.TRANSACTION_BATCH_SIZE}, workers=${this.config.WORKER_COUNT}`,
        );

        this.progressTracker = new IBDProgressTracker(this.db, this.config.CHECKPOINT_INTERVAL);
    }

    /**
     * Initialize the IBD coordinator
     */
    public init(): void {
        this.progressTracker.init();
        this.info('IBD Coordinator initialized');
    }

    /**
     * Detect if IBD mode should be used
     */
    public async detectIBDMode(currentHeight: bigint): Promise<IBDDetectionResult> {
        // IBD is disabled
        if (!this.config.ENABLED) {
            return {
                shouldUseIBD: false,
                startHeight: currentHeight,
                targetHeight: currentHeight,
                reason: 'IBD disabled in configuration',
            };
        }

        // Regtest always has OPNet at block 0 - no IBD possible
        if (Config.BITCOIN.NETWORK === BitcoinNetwork.regtest) {
            return {
                shouldUseIBD: false,
                startHeight: currentHeight,
                targetHeight: currentHeight,
                reason: 'Regtest network - OPNet active from block 0',
            };
        }

        // Get OPNet activation height
        const opnetEnabled = OPNetConsensus.opnetEnabled;
        if (!opnetEnabled.ENABLED || !opnetEnabled.BLOCK) {
            // OPNet not configured for this network - full IBD to chain tip
            const chainHeight = await this.getChainHeight();
            const targetHeight = chainHeight;

            if (targetHeight - currentHeight < BigInt(this.config.IBD_THRESHOLD)) {
                return {
                    shouldUseIBD: false,
                    startHeight: currentHeight,
                    targetHeight,
                    reason: `Not far enough behind (${targetHeight - currentHeight} blocks < ${this.config.IBD_THRESHOLD} threshold)`,
                };
            }

            return {
                shouldUseIBD: true,
                startHeight: currentHeight,
                targetHeight,
                reason: 'OPNet not configured - IBD to chain tip',
            };
        }

        const opnetBlock = opnetEnabled.BLOCK;

        // Get actual chain height from RPC
        const chainHeight = await this.getChainHeight();

        // Target is the minimum of chain tip and OPNet activation height
        // (can't download blocks that don't exist yet)
        const targetHeight = chainHeight < opnetBlock ? chainHeight : opnetBlock;

        // Already past OPNet activation - no IBD
        if (currentHeight >= opnetBlock) {
            return {
                shouldUseIBD: false,
                startHeight: currentHeight,
                targetHeight: opnetBlock,
                reason: 'Already past OPNet activation height',
            };
        }

        // Check if we're far enough behind to use IBD
        const blocksToSync = targetHeight - currentHeight;
        if (blocksToSync < BigInt(this.config.IBD_THRESHOLD)) {
            return {
                shouldUseIBD: false,
                startHeight: currentHeight,
                targetHeight,
                reason: `Not far enough behind (${blocksToSync} blocks < ${this.config.IBD_THRESHOLD} threshold)`,
            };
        }

        // Check for existing checkpoint
        const hasCheckpoint = await this.progressTracker.hasCheckpoint();
        if (hasCheckpoint) {
            const checkpoint = await this.progressTracker.loadCheckpoint();
            if (checkpoint) {
                // Verify checkpoint integrity and get valid resume height
                const resumeHeight = await this.verifyCheckpointIntegrity(checkpoint);
                if (resumeHeight === null) {
                    this.warn(
                        `Checkpoint at height ${checkpoint.lastCompletedHeight} is invalid ` +
                            `(no valid headers found). Clearing checkpoint and starting fresh.`,
                    );
                    await this.progressTracker.clearCheckpoint();
                    // Fall through to start fresh IBD
                } else {
                    // Update target height in case chain has grown since checkpoint
                    const checkpointTarget =
                        checkpoint.targetHeight < targetHeight
                            ? checkpoint.targetHeight
                            : targetHeight;
                    return {
                        shouldUseIBD: true,
                        startHeight: resumeHeight,
                        targetHeight: checkpointTarget,
                        reason: `Resuming IBD from height ${resumeHeight} (phase: ${checkpoint.phase})`,
                    };
                }
            }
        }

        return {
            shouldUseIBD: true,
            startHeight: currentHeight,
            targetHeight,
            reason: `${blocksToSync} blocks behind (target: ${targetHeight}) - using IBD`,
        };
    }

    /**
     * Run the IBD process
     */
    public async run(startHeight: bigint, targetHeight: bigint): Promise<boolean> {
        if (this.isRunning) {
            this.warn('IBD already running');
            return false;
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        this.success(`Starting IBD from ${startHeight} to ${targetHeight}`);

        try {
            // Check for checkpoint to resume from
            let state: IBDState;
            const checkpoint = await this.progressTracker.loadCheckpoint();

            if (checkpoint && checkpoint.phase !== IBDPhase.COMPLETE) {
                state = this.progressTracker.createStateFromCheckpoint(checkpoint);
                // Always use the passed-in targetHeight (actual chain tip) instead of
                // the checkpoint's stored target which may be outdated
                state.targetHeight = targetHeight;
                this.info(`Resuming IBD from phase: ${checkpoint.phase}`);
            } else {
                state = this.progressTracker.createInitialState(startHeight, targetHeight);
            }

            // Initialize phases
            this.initializePhases();

            // Run phases in sequence
            let success = true;

            // Phase 1: Header Download
            if (state.phase === IBDPhase.HEADER_DOWNLOAD) {
                success = await this.runHeaderDownloadPhase(state);
                if (!success || this.shouldAbort()) {
                    return this.handleAbort('Header download');
                }
                state.currentHeight = state.startHeight;
                state.phase = IBDPhase.CHECKSUM_GENERATION;
                // Save checkpoint with new phase
                await this.progressTracker.saveCheckpoint(
                    state.phase,
                    state.startHeight,
                    state.targetHeight,
                );
            }

            // Phase 2: Checksum Generation (only needs headers, not transactions)
            if (state.phase === IBDPhase.CHECKSUM_GENERATION) {
                success = await this.runChecksumPhase(state);
                if (!success || this.shouldAbort()) {
                    return this.handleAbort('Checksum generation');
                }
                state.currentHeight = state.startHeight;
                state.phase = IBDPhase.TRANSACTION_DOWNLOAD;
                // Save checkpoint with new phase
                await this.progressTracker.saveCheckpoint(
                    state.phase,
                    state.startHeight,
                    state.targetHeight,
                );
            }

            // Phase 3: Transaction Download
            if (state.phase === IBDPhase.TRANSACTION_DOWNLOAD) {
                success = await this.runTransactionDownloadPhase(state);
                if (!success || this.shouldAbort()) {
                    return this.handleAbort('Transaction download');
                }
                state.currentHeight = state.startHeight;
                // Skip witness sync by default - witnesses are not mandatory for pre-OPNet blocks
                state.phase = IBDPhase.EPOCH_FINALIZATION;
                // Save checkpoint with new phase
                await this.progressTracker.saveCheckpoint(
                    state.phase,
                    state.startHeight,
                    state.targetHeight,
                );
            }

            // Phase 4: Witness Sync (skipped by default for IBD)
            // Witnesses can be synced later during normal operation
            if (state.phase === IBDPhase.WITNESS_SYNC) {
                this.info('Skipping Witness Sync Phase - witnesses are not mandatory for IBD');
                state.currentHeight = state.startHeight;
                state.phase = IBDPhase.EPOCH_FINALIZATION;
                // Save checkpoint with new phase
                await this.progressTracker.saveCheckpoint(
                    state.phase,
                    state.startHeight,
                    state.targetHeight,
                );
            }

            // Phase 5: Epoch Finalization
            if (state.phase === IBDPhase.EPOCH_FINALIZATION) {
                success = await this.runEpochFinalizationPhase(state);
                if (!success || this.shouldAbort()) {
                    return this.handleAbort('Epoch finalization');
                }
            }

            // Mark complete
            await this.progressTracker.markComplete();

            this.success(
                `IBD completed successfully! Processed ${targetHeight - startHeight} blocks`,
            );
            this.isRunning = false;

            return true;
        } catch (error) {
            this.error(`IBD failed: ${error}`);
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Abort IBD completely
     */
    public abort(): void {
        this.abortController.abort();
        this.isRunning = false;
        this.warn('IBD aborted');
    }

    /**
     * Check if IBD is currently running
     */
    public isIBDRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Get current IBD state
     */
    public getState(): IBDState | undefined {
        return this.progressTracker.getState();
    }

    /**
     * Initialize all phases
     */
    private initializePhases(): void {
        this.headerPhase = new HeaderDownloadPhase(this.rpc, this.blockRepository, this.progressTracker, {
            batchSize: this.config.HEADER_BATCH_SIZE,
            workerCount: this.config.WORKER_COUNT,
        });

        this.transactionPhase = new TransactionDownloadPhase(this.progressTracker, {
            batchSize: this.config.TRANSACTION_BATCH_SIZE,
            workerCount: this.config.WORKER_COUNT,
        });

        this.checksumPhase = new ChecksumGenerationPhase(
            this.blockRepository,
            this.vmStorage,
            this.progressTracker,
        );

        this.witnessSyncPhase = new WitnessSyncPhase(this.progressTracker, this.requestWitnesses);

        this.epochFinalizationPhase = new EpochFinalizationPhase(
            this.epochManager,
            this.progressTracker,
        );

        // Wire up messaging
        this.headerPhase.sendMessageToThread = this.sendMessageToThread;
        this.transactionPhase.sendMessageToThread = this.sendMessageToThread;
    }

    /**
     * Run header download phase
     */
    private async runHeaderDownloadPhase(state: IBDState): Promise<boolean> {
        if (!this.headerPhase) {
            throw new Error('Header phase not initialized');
        }

        this.info(`Starting Header Download Phase: ${state.currentHeight} -> ${state.targetHeight}`);

        const startTime = Date.now();

        const result = await this.headerPhase.run(
            state.currentHeight,
            state.targetHeight,
            this.abortController.signal,
        );

        const elapsed = (Date.now() - startTime) / 1000;
        const blocksProcessed = state.targetHeight - state.currentHeight;

        this.success(
            `Header Download Phase complete: ${blocksProcessed} headers in ${elapsed.toFixed(1)}s ` +
                `(${(Number(blocksProcessed) / elapsed).toFixed(1)} headers/s)`,
        );

        return result;
    }

    /**
     * Run transaction download phase
     */
    private async runTransactionDownloadPhase(state: IBDState): Promise<boolean> {
        if (!this.transactionPhase) {
            throw new Error('Transaction phase not initialized');
        }

        // Check if we should skip transaction downloading until START_INDEXING_UTXO_AT_BLOCK_HEIGHT
        let effectiveStartHeight = state.currentHeight;
        const skipUntilHeight = BigInt(Config.INDEXER.START_INDEXING_UTXO_AT_BLOCK_HEIGHT);

        if (skipUntilHeight > 0n && effectiveStartHeight < skipUntilHeight) {
            if (skipUntilHeight >= state.targetHeight) {
                this.info(
                    `Skipping Transaction Download Phase entirely - ` +
                    `START_INDEXING_UTXO_AT_BLOCK_HEIGHT (${skipUntilHeight}) >= target (${state.targetHeight})`,
                );
                return true;
            }

            this.info(
                `Skipping transaction download for blocks ${effectiveStartHeight} to ${skipUntilHeight - 1n} ` +
                `(START_INDEXING_UTXO_AT_BLOCK_HEIGHT=${skipUntilHeight})`,
            );
            effectiveStartHeight = skipUntilHeight;
        }

        this.info(
            `Starting Transaction Download Phase: ${effectiveStartHeight} -> ${state.targetHeight}`,
        );

        const startTime = Date.now();

        const result = await this.transactionPhase.run(
            effectiveStartHeight,
            state.targetHeight,
            this.abortController.signal,
        );

        const elapsed = (Date.now() - startTime) / 1000;
        const blocksProcessed = state.targetHeight - effectiveStartHeight;

        this.success(
            `Transaction Download Phase complete: ${blocksProcessed} blocks in ${elapsed.toFixed(1)}s ` +
                `(${(Number(blocksProcessed) / elapsed).toFixed(1)} blocks/s)`,
        );

        return result;
    }

    /**
     * Run checksum generation phase
     */
    private async runChecksumPhase(state: IBDState): Promise<boolean> {
        if (!this.checksumPhase) {
            throw new Error('Checksum phase not initialized');
        }

        this.info(
            `Starting Checksum Generation Phase: ${state.currentHeight} -> ${state.targetHeight}`,
        );

        const startTime = Date.now();

        const result = await this.checksumPhase.run(
            state.currentHeight,
            state.targetHeight,
            this.abortController.signal,
        );

        const elapsed = (Date.now() - startTime) / 1000;
        const blocksProcessed = state.targetHeight - state.currentHeight;

        this.success(
            `Checksum Generation Phase complete: ${blocksProcessed} blocks in ${elapsed.toFixed(1)}s ` +
                `(${(Number(blocksProcessed) / elapsed).toFixed(1)} blocks/s)`,
        );

        return result;
    }

    /**
     * Run witness sync phase
     */
    private async runWitnessSyncPhase(state: IBDState): Promise<boolean> {
        if (!this.witnessSyncPhase) {
            throw new Error('Witness sync phase not initialized');
        }

        this.info(`Starting Witness Sync Phase: ${state.currentHeight} -> ${state.targetHeight}`);

        const startTime = Date.now();

        const result = await this.witnessSyncPhase.run(
            state.currentHeight,
            state.targetHeight,
            this.abortController.signal,
        );

        const elapsed = (Date.now() - startTime) / 1000;
        const blocksProcessed = state.targetHeight - state.currentHeight;

        this.success(
            `Witness Sync Phase complete: ${blocksProcessed} blocks in ${elapsed.toFixed(1)}s ` +
                `(${(Number(blocksProcessed) / elapsed).toFixed(1)} blocks/s)`,
        );

        return result;
    }

    /**
     * Run epoch finalization phase
     */
    private async runEpochFinalizationPhase(state: IBDState): Promise<boolean> {
        if (!this.epochFinalizationPhase) {
            throw new Error('Epoch finalization phase not initialized');
        }

        this.info(
            `Starting Epoch Finalization Phase: ${state.currentHeight} -> ${state.targetHeight}`,
        );

        const startTime = Date.now();

        const result = await this.epochFinalizationPhase.run(
            state.currentHeight,
            state.targetHeight,
            this.abortController.signal,
        );

        const elapsed = (Date.now() - startTime) / 1000;

        this.success(`Epoch Finalization Phase complete in ${elapsed.toFixed(1)}s`);

        return result;
    }

    /**
     * Get current chain height from RPC
     */
    private async getChainHeight(): Promise<bigint> {
        const height = await this.rpc.getBlockCount();
        if (height === null) {
            throw new Error('Failed to get chain height');
        }
        return BigInt(height);
    }

    /**
     * Check if abort was requested
     */
    private shouldAbort(): boolean {
        return this.abortController.signal.aborted;
    }

    /**
     * Handle abort scenario
     */
    private handleAbort(phase: string): boolean {
        this.warn(`IBD aborted during ${phase}`);
        this.isRunning = false;
        return false;
    }

    /**
     * Verify checkpoint integrity and find the actual resume point
     * Returns the valid resume height, or null if we should start fresh
     */
    private async verifyCheckpointIntegrity(checkpoint: IBDCheckpoint): Promise<bigint | null> {
        try {
            const { originalStartHeight, lastCompletedHeight, phase } = checkpoint;

            // If we haven't made any progress, checkpoint is valid
            if (lastCompletedHeight <= originalStartHeight) {
                return lastCompletedHeight;
            }

            // Find the highest block header that actually exists in the DB
            const latestHeight = await this.blockRepository.getMaxBlockHeight();
            if (latestHeight === null) {
                this.warn('No block headers found in database');
                return null;
            }

            this.info(`Latest block height in DB: ${latestHeight}`);

            // If DB is completely empty or way behind original start, start fresh
            if (latestHeight < originalStartHeight) {
                this.warn(
                    `Latest block ${latestHeight} is before original start ${originalStartHeight}`,
                );
                return null;
            }

            // For header download phase
            if (phase === IBDPhase.HEADER_DOWNLOAD) {
                const resumeHeight =
                    latestHeight < lastCompletedHeight ? latestHeight : lastCompletedHeight;
                this.info(
                    `Header phase: resuming from ${resumeHeight} (checkpoint was ${lastCompletedHeight}, latest in DB is ${latestHeight})`,
                );
                return resumeHeight;
            }

            // For transaction download phase
            if (phase === IBDPhase.TRANSACTION_DOWNLOAD) {
                const resumeHeight =
                    latestHeight < lastCompletedHeight ? latestHeight : lastCompletedHeight;
                this.info(`Transaction phase: resuming from ${resumeHeight}`);
                return resumeHeight;
            }

            // For checksum phase, find the highest block with a valid checksum
            if (phase === IBDPhase.CHECKSUM_GENERATION) {
                const lastHeader = await this.blockRepository.getBlockHeader(lastCompletedHeight);
                if (lastHeader && lastHeader.checksumRoot && lastHeader.checksumRoot !== '') {
                    this.info(`Checksum phase: verified checksums up to ${lastCompletedHeight}`);
                    return lastCompletedHeight;
                }

                // Checkpoint height doesn't have checksum, find the highest that does
                this.warn(`Checksum at ${lastCompletedHeight} missing, will redo from start`);
                return originalStartHeight;
            }

            // For witness sync and epoch finalization phases
            if (
                phase === IBDPhase.WITNESS_SYNC ||
                phase === IBDPhase.EPOCH_FINALIZATION
            ) {
                this.info(`${phase}: resuming from ${lastCompletedHeight}`);
                return lastCompletedHeight;
            }

            return lastCompletedHeight;
        } catch (error) {
            this.error(`Error verifying checkpoint integrity: ${error}`);
            return null;
        }
    }
}
