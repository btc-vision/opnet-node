import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { Config } from '../../config/Config.js';
import { RPCBlockFetcher } from '../fetcher/RPCBlockFetcher.js';
import { CurrentIndexerBlockResponseData } from '../../threading/interfaces/thread-messages/messages/indexer/CurrentIndexerBlock.js';
import { ChainObserver } from './observer/ChainObserver.js';
import { IndexingTask } from './tasks/IndexingTask.js';
import { BlockFetcher } from '../fetcher/abstract/BlockFetcher.js';
import { BitcoinRPC, BlockDataWithTransactionData, BlockHeaderInfo } from '@btc-vision/bitcoin-rpc';
import { ConsensusTracker } from './consensus/ConsensusTracker.js';
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';
import { VMMongoStorage } from '../../vm/storage/databases/VMMongoStorage.js';
import {
    BlockProcessedData,
    BlockProcessedMessage,
} from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import { Network } from '@btc-vision/bitcoin';
import { ReorgWatchdog } from './reorg/ReorgWatchdog.js';
import { IReorgData } from '../../db/interfaces/IReorgDocument.js';
import { VMManager } from '../../vm/VMManager.js';
import { SpecialManager } from './special-transaction/SpecialManager.js';
import { OPNetIndexerMode } from '../../config/interfaces/OPNetIndexerMode.js';
import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';
import fs from 'fs';
import { EpochManager } from './epoch/EpochManager.js';
import { EpochReindexer } from './epoch/EpochReindexer.js';
import { TransactionReindexer } from './transaction/TransactionReindexer.js';

export class BlockIndexer extends Logger {
    public readonly logColor: string = '#00ffe1';

    private chainReorged: boolean = false;

    private readonly database: ConfigurableDBManager = new ConfigurableDBManager(Config);
    private readonly vmStorage: VMStorage = this.getVMStorage();

    private readonly vmManager: VMManager = new VMManager(Config, false, this.vmStorage);
    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly consensusTracker: ConsensusTracker = new ConsensusTracker();
    private readonly specialTransactionManager: SpecialManager = new SpecialManager(this.vmManager);

    //private readonly inspector: Inspector = new Inspector();
    //private readonly workerPool: WorkerPoolManager = new WorkerPoolManager();

    private currentTask?: IndexingTask;

    private started: boolean = false;

    private readonly indexingConfigs = {
        prefetchQueueSize: Config.OP_NET.MAXIMUM_PREFETCH_BLOCKS,
    };

    private readonly chainObserver: ChainObserver = new ChainObserver(
        Config.BITCOIN.NETWORK,
        this.database,
        this.rpcClient,
        this.consensusTracker,
        this.vmStorage,
    );

    private readonly reorgWatchdog: ReorgWatchdog = new ReorgWatchdog(
        this.vmStorage,
        this.vmManager,
        this.rpcClient,
    );

    private readonly epochManager: EpochManager = new EpochManager(this.vmStorage);
    private readonly epochReindexer: EpochReindexer = new EpochReindexer(
        this.vmStorage,
        this.epochManager,
    );

    private readonly transactionReindexer: TransactionReindexer = new TransactionReindexer(
        this.vmStorage,
    );

    private readonly network: Network = NetworkConverter.getNetwork();

    private indexingTasks: IndexingTask[] = [];
    private taskInProgress: boolean = false;

    private processedBlocks: number = 0;
    private lastSyncErrored: boolean = false;

    constructor() {
        super();

        this.chainObserver.notifyBlockProcessed = this.notifyBlockProcessed.bind(this);
    }

    private _blockFetcher: BlockFetcher | undefined;

    private get blockFetcher(): BlockFetcher {
        if (!this._blockFetcher) {
            throw new Error('BlockFetcher not initialized');
        }

        return this._blockFetcher;
    }

    private get isLightNode(): boolean {
        return Config.OP_NET.MODE === OPNetIndexerMode.LIGHT;
    }

    public sendMessageToAllThreads: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<void> = () => {
        throw new Error('sendMessageToAllThreads not implemented.');
    };

    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    //public processInteractionTx: ProcessTask = async (data: ParseTask) => {
    //    return await this.workerPool.parse(data);
    //};

    public async handleMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData | undefined> {
        let resp: ThreadData;
        switch (m.type) {
            case MessageType.CURRENT_INDEXER_BLOCK: {
                resp = this.getCurrentBlock();
                break;
            }
            case MessageType.START_INDEXER: {
                resp = await this.startIndexer();
                break;
            }
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoA.`);
        }

        return resp ?? undefined;
    }

    private async init(): Promise<void> {
        this.debugBright(`Starting up blockchain indexer thread...`);

        // Wire up epoch manager's messaging capability
        this.epochManager.sendMessageToThread = this.sendMessageToThread;

        await this.rpcClient.init(Config.BLOCKCHAIN);

        this._blockFetcher = new RPCBlockFetcher({
            maximumPrefetchBlocks: Config.OP_NET.MAXIMUM_PREFETCH_BLOCKS,
            rpc: this.rpcClient,
        });

        // Start the chain observer.
        await this.vmStorage.init();
        await this.chainObserver.init();

        // First, we check if this node is allowed to write data.
        if (Config.INDEXER.READONLY_MODE) {
            this.chainObserver.watchBlockchain();
            return;
        }

        const mayStart = await this.verifyCommitConflicts();
        if (!mayStart) {
            throw new Error('Database is locked or corrupted.');
        }

        // Check for epoch-only reindex mode (preserves all data except epochs)
        if (Config.OP_NET.EPOCH_REINDEX) {
            await this.handleEpochReindex();
        }

        // Check for transaction reindex mode (reorders transactions in blocks)
        if (Config.OP_NET.TRANSACTION_REINDEX) {
            await this.handleTransactionReindex();
        }

        // Always purge, in case of bad indexing of the last block.
        const purgeFromBlock = Config.OP_NET.REINDEX
            ? BigInt(Config.OP_NET.REINDEX_FROM_BLOCK)
            : this.chainObserver.pendingBlockHeight;

        this.warn(`Safely purging data from block ${purgeFromBlock}`);

        // Purge.
        const originalHeight = this.chainObserver.pendingBlockHeight;
        await this.vmStorage.revertDataUntilBlock(purgeFromBlock);
        this.log(`Setting new height... ${purgeFromBlock}`);

        await this.chainObserver.setNewHeight(purgeFromBlock);

        // Notify plugins of the startup purge so they can also clean their data
        // Always notify when plugins enabled - the purge always happens for safety
        if (Config.PLUGINS.PLUGINS_ENABLED) {
            const reason = Config.OP_NET.REINDEX ? 'reindex' : 'startup-purge';
            try {
                await this.notifyPluginsOfReorg(purgeFromBlock, originalHeight, reason);
            } catch (error) {
                // Link to plugin thread may not be established yet during startup
                // Log warning but continue - plugins should handle missing data on their own
                this.warn(
                    `Could not notify plugins of startup purge: ${error}. ` +
                        `Plugins may need to resync data from block ${purgeFromBlock}.`,
                );
            }
        }

        this.log(`Starting watchdog...`);

        await this.reorgWatchdog.init(originalHeight);

        // If we detect db corruption, we try to restore from the last known good block.
        if (
            this.reorgWatchdog.pendingBlockHeight !== originalHeight &&
            this.reorgWatchdog.pendingBlockHeight !== -1n
        ) {
            await this.onHeightMismatch(originalHeight);
        }

        try {
            await this.verifyMode();
        } catch (e) {
            this.fail(`Failed to create light node last block: ${e}`);

            return;
        }

        await this.registerEvents();
    }

    private async onHeightMismatch(originalHeight: bigint): Promise<void> {
        this.fail(
            `Reorg watchdog height mismatch: ${this.reorgWatchdog.pendingBlockHeight}. Reverting.`,
        );

        this.taskInProgress = true;

        await this.revertChain(
            this.reorgWatchdog.pendingBlockHeight,
            originalHeight,
            'database-corrupted',
            false,
        );

        this.taskInProgress = false;
    }

    private async handleEpochReindex(): Promise<void> {
        if (Config.OP_NET.REINDEX) {
            throw new Error(
                'Cannot use EPOCH_REINDEX and REINDEX at the same time. Please choose one.',
            );
        }

        const fromEpoch = BigInt(Config.OP_NET.EPOCH_REINDEX_FROM_EPOCH);
        if (fromEpoch < 0n) {
            throw new Error(`EPOCH_REINDEX_FROM_EPOCH cannot be negative: ${fromEpoch}`);
        }

        const currentBlockHeight = this.chainObserver.pendingBlockHeight;

        this.warn(`---- EPOCH-ONLY REINDEX MODE (this will take a while) ----`);
        this.warn(`Starting from epoch: ${fromEpoch}`);
        this.warn(`Current block height: ${currentBlockHeight}`);

        const success = await this.epochReindexer.reindexEpochs(fromEpoch, currentBlockHeight);
        if (!success) {
            throw new Error('Epoch reindex failed or was aborted');
        }

        this.success(`Epoch reindex completed. Resuming normal operation.`);
    }

    private async handleTransactionReindex(): Promise<void> {
        if (Config.OP_NET.REINDEX) {
            throw new Error(
                'Cannot use TRANSACTION_REINDEX and REINDEX at the same time. Please choose one.',
            );
        }

        const fromBlock = BigInt(Config.OP_NET.TRANSACTION_REINDEX_FROM_BLOCK);
        if (fromBlock < 0n) {
            throw new Error(`TRANSACTION_REINDEX_FROM_BLOCK cannot be negative: ${fromBlock}`);
        }

        const currentBlockHeight = this.chainObserver.pendingBlockHeight;

        this.warn(`---- TRANSACTION REINDEX MODE (Generic transactions only) ----`);
        this.warn(`Starting from block: ${fromBlock}`);
        this.warn(`Current block height: ${currentBlockHeight}`);

        const success = await this.transactionReindexer.reindexTransactions(
            fromBlock,
            currentBlockHeight,
        );
        if (!success) {
            throw new Error('Transaction reindex failed or was aborted');
        }

        this.success(`Transaction reindex completed. Resuming normal operation.`);
    }

    private async verifyMode(): Promise<void> {
        if (!this.isLightNode) {
            this.info(`Node need the full blockchain to work. Starting full node...`);
            return;
        }

        this.info(
            `---- Your node is running in light mode. This means your node will only know a limited set of the blockchain. Some api routes might return incomplete data. ----`,
        );

        this.info(`Chain height: ${this.chainObserver.targetBlockHeight}`);
        this.info(`Node sync target block ${this.nodeSyncLightTargetBlock()}`);

        await this.createLightNodeLastBlock(this.nodeSyncLightTargetBlock());
    }

    private async createLightNodeLastBlock(tip: bigint): Promise<void> {
        const opnetEnabledAtBlock = OPNetConsensus.opnetEnabled;
        if (
            opnetEnabledAtBlock.ENABLED &&
            opnetEnabledAtBlock.BLOCK &&
            opnetEnabledAtBlock.BLOCK < tip
        ) {
            this.fail(
                `OPNet states will be invalid, your light node will be missing critical states in other for smart contracts to work correctly.`,
            );

            this.fail(`Please reindex from block ${opnetEnabledAtBlock.BLOCK}.`);

            throw new Error(`Cannot sync light mode from that height.`);
        }

        const blockHeader = await this.chainObserver.getBlockHeader(tip - 2n);
        if (!blockHeader) {
            return await this.createBlockHeader(tip);
        }

        this.success(`----- Light node ready. -----`);
    }

    private async createBlockHeader(tip: bigint): Promise<void> {
        this.chainObserver.nextBestTip = tip;

        const [firstBlock, secondBlock] = await Promise.safeAll([
            this.blockFetcher.getBlock(tip - 2n),
            this.blockFetcher.getBlock(tip - 1n),
        ]);

        if (!firstBlock || !secondBlock) {
            throw new Error(`Unable to fetch block header for ${tip}.`);
        }

        const proofFirstBlock = await this.processLightBlock(firstBlock);
        if (!proofFirstBlock) {
            throw new Error(`Unable to process block header for ${tip - 2n}.`);
        }

        const proofSecondBlock = await this.processLightBlock(secondBlock);
        if (!proofSecondBlock) {
            throw new Error(`Unable to process block header for ${tip - 1n}.`);
        }

        const blockHeader = await this.chainObserver.getBlockHeader(tip - 2n);
        if (!blockHeader) {
            throw new Error(`Failed to generate light block headers for ${tip - 2n}.`);
        }

        this.success(`Block header ready.`);
    }

    private async processLightBlock(_data: BlockDataWithTransactionData): Promise<boolean> {
        await Promise.resolve();
        throw new Error('Light mode processing is not implemented yet.');

        // TODO: Finish this.
        /*const abortController = new AbortController();
        const block = new Block({
            network: this.network,
            abortController: abortController,
            header: data,
            processEverythingAsGeneric: true,
            allowedSolutions: new AddressMap()
        });

        block.deserialize(false);

        this.info(`Light mode -> Loaded block: ${block.height} - ${block.hash}`);

        this.vmManager.prepareBlock(block.height);

        await block.onEmptyBlock(this.vmManager);
        return await block.finalizeBlock(this.vmManager);*/
    }

    private nodeSyncLightTargetBlock(): bigint {
        return this.chainObserver.targetBlockHeight - BigInt(Config.OP_NET.LIGHT_MODE_FROM_BLOCK);
    }

    private async registerEvents(): Promise<void> {
        this.blockFetcher.subscribeToBlockChanges((header: BlockHeaderInfo) => {
            this.onBlockChange(header);
        });

        this.reorgWatchdog.subscribeToReorgs(
            async (fromHeight: bigint, toHeight: bigint, newBest: string) => {
                await this.revertChain(fromHeight, toHeight, newBest, true);
            },
        );

        await this.blockFetcher.watchBlockChanges(true);
    }

    private onBlockChange(header: BlockHeaderInfo): void {
        this.reorgWatchdog.onBlockChange(header);
        this.chainObserver.onBlockChange(header);

        if (Config.DEV.PROCESS_ONLY_X_BLOCK) {
            if (this.processedBlocks >= Config.DEV.PROCESS_ONLY_X_BLOCK) {
                return;
            }
        }

        if (!this.started) {
            this.startTasks();
            this.started = true;

            return;
        } else if (this.taskInProgress && this.indexingTasks.length !== 0) {
            return;
        }

        this.startTasks();
    }

    private async notifyThreadReorg(
        fromHeight: bigint,
        toHeight: bigint,
        newBest: string,
    ): Promise<void> {
        const msg: ThreadMessageBase<MessageType> = {
            type: MessageType.CHAIN_REORG,
            data: {
                fromHeight: fromHeight,
                toHeight: toHeight,
                newBest: newBest,
            },
        };

        await this.sendMessageToAllThreads(ThreadTypes.SYNCHRONISATION, msg);
    }

    /**
     * Revert the chain to the specified height.
     * @param fromHeight The height to revert from.
     * @param toHeight The height to revert to.
     * @param newBest The new best block hash or a reason for the reorg.
     * @param reorged Whether the chain was reorged.
     * @private
     */
    private async revertChain(
        fromHeight: bigint,
        toHeight: bigint,
        newBest: string,
        reorged: boolean,
    ): Promise<void> {
        // Lock tasks.
        this.chainReorged = true;

        try {
            // Stop all tasks.
            await this.stopAllTasks(reorged);

            // Clean up cached data.
            this.blockFetcher.onReorg();

            // Stop all tasks, if one is still running.
            await this.stopAllTasks(reorged);

            // Notify thread.
            await this.notifyThreadReorg(fromHeight, toHeight, newBest);

            // Await all pending writes.
            await this.vmStorage.killAllPendingWrites();

            // Revert block data FIRST - main thread work must complete before plugins
            await this.vmStorage.revertDataUntilBlock(fromHeight);
            await this.chainObserver.onChainReorganisation(fromHeight, toHeight, newBest);

            // Revert data.
            if (reorged) await this.reorgFromHeight(fromHeight, toHeight);

            // AFTER main thread completes reorg, notify plugins
            // This is BLOCKING - we wait for all plugins to complete their reorg handling
            await this.notifyPluginsOfReorg(fromHeight, toHeight, newBest);
        } finally {
            // Unlock tasks.
            this.chainReorged = false;
        }
    }

    /**
     * Notify plugins of a chain reorg (BLOCKING)
     * This sends a message to the Plugin thread which dispatches to PluginManager
     * Called AFTER main thread completes its reorg work so plugins see consistent state
     */
    private async notifyPluginsOfReorg(
        fromHeight: bigint,
        toHeight: bigint,
        reason: string,
    ): Promise<void> {
        const pluginReorgMsg: ThreadMessageBase<MessageType> = {
            type: MessageType.PLUGIN_REORG,
            data: {
                fromBlock: fromHeight,
                toBlock: toHeight,
                reason: reason,
            },
        };

        // Send blocking message to plugin thread - MUST wait for response
        this.info(`Notifying plugins of reorg: from ${fromHeight} to ${toHeight}`);
        const response = await this.sendMessageToThread(ThreadTypes.PLUGIN, pluginReorgMsg);

        if (response && (response as { error?: string }).error) {
            this.error(
                `Plugin reorg notification failed: ${(response as { error?: string }).error}`,
            );
        } else {
            this.info(`Plugin reorg notification complete`);
        }
    }

    private async reorgFromHeight(fromHeight: bigint, toBlock: bigint): Promise<void> {
        const reorgData: IReorgData = {
            fromBlock: fromHeight,
            toBlock: toBlock,
            timestamp: new Date(),
        };

        if (fromHeight <= 0n) {
            throw new Error(`Block height must be greater than 0. Was ${fromHeight}.`);
        }

        await this.vmStorage.setReorg(reorgData);
    }

    private async stopAllTasks(reorged: boolean): Promise<void> {
        if (this.currentTask) {
            await this.currentTask.cancel(reorged);
        }

        for (const task of this.indexingTasks) {
            await task.cancel(reorged);
        }

        this.currentTask = undefined;
        this.indexingTasks = [];
    }

    private async verifyCommitConflicts(): Promise<boolean> {
        // TODO: Verify if sync was stopped unexpectedly.
        this.warn(`Verifying database integrity...`);

        try {
            await this.vmStorage.killAllPendingWrites();

            return true;
        } catch (e) {
            this.panic(`Database is locked or corrupted. Details: ${e}`);

            return false;
        }
    }

    private async notifyBlockProcessed(blockHeader: BlockProcessedData): Promise<void> {
        const msg: BlockProcessedMessage = {
            type: MessageType.BLOCK_PROCESSED,
            data: blockHeader,
        };

        await this.sendMessageToThread(ThreadTypes.P2P, msg);

        // Send plugin block change notification to plugin thread
        const pluginMsg: ThreadMessageBase<MessageType> = {
            type: MessageType.PLUGIN_BLOCK_CHANGE,
            data: blockHeader,
        };
        await this.sendMessageToThread(ThreadTypes.PLUGIN, pluginMsg);
    }

    private getVMStorage(): VMStorage {
        if (this.vmStorage) return this.vmStorage;

        switch (Config.INDEXER.STORAGE_TYPE) {
            case IndexerStorageType.MONGODB:
                return new VMMongoStorage(Config, this.database);
            default:
                throw new Error('Invalid VM Storage type.');
        }
    }

    private startTasks(): void {
        // Check if the chain is reorged.
        if (this.chainReorged) return;

        // Calculate the number of tasks to start.
        const currentIndexingLength =
            this.indexingConfigs.prefetchQueueSize - this.indexingTasks.length;

        // Start the indexing tasks.
        for (let i = 0; i < currentIndexingLength; i++) {
            if (this.chainObserver.targetBlockHeight < this.chainObserver.pendingTaskHeight) {
                break;
            }

            try {
                this.nextTask();
            } catch (e) {
                this.error(`Error starting task: ${e}`);
            }
        }

        if (this.indexingTasks.length) {
            // If we have tasks, we start processing them.
            void this.processNextTask();
        }
    }

    private nextTask(): IndexingTask {
        const currentBestTip = this.chainObserver.nextBestTip;
        const task = new IndexingTask(
            currentBestTip,
            this.network,
            this.chainObserver,
            this.consensusTracker,
            this.vmStorage,
            this.vmManager,
            this.specialTransactionManager,
        );

        task.sendMessageToThread = this.sendMessageToThread;
        task.onComplete = async () => this.onCompletedTask(task);
        task.verifyReorg = async () => this.reorgWatchdog.verifyChainReorgForBlock(task);

        this.indexingTasks.push(task);

        task.prefetch();

        return task;
    }

    private async onCompletedTask(task: IndexingTask): Promise<void> {
        if (task.chainReorged || task.aborted) return;

        const processedBlock = task.block;

        // Update epoch.
        await this.epochManager.updateEpoch(task);

        if (!this.taskInProgress) {
            throw new Error('Database corrupted. Two tasks are running at the same time.');
        }

        // Update height.
        await this.chainObserver.setNewHeight(task.tip);

        // Notify PoC
        void this.notifyBlockProcessed({
            blockNumber: processedBlock.height,
            blockHash: processedBlock.hash,
            previousBlockHash: processedBlock.previousBlockHash,

            merkleRoot: processedBlock.merkleRoot,
            receiptRoot: processedBlock.receiptRoot,
            storageRoot: processedBlock.storageRoot,

            checksumHash: processedBlock.checksumRoot,
            checksumProofs: processedBlock.checksumProofs.map((proof) => {
                return {
                    proof: proof[1],
                };
            }),
            previousBlockChecksum: processedBlock.previousBlockChecksum,
            txCount: processedBlock.header.nTx,
        });

        task.destroy();

        this.vmManager.blockHeaderValidator.setLastBlockHeader(
            processedBlock.getBlockHeaderDocument(),
        );

        if (Config.DEV.PROCESS_ONLY_X_BLOCK) {
            this.processedBlocks++;
        }
    }

    private async processNextTask(): Promise<void> {
        if (this.taskInProgress) return;
        this.taskInProgress = true;

        let mayRestartTask: boolean = true;
        try {
            this.currentTask = this.indexingTasks.shift();
            if (!this.currentTask) return;

            await this.currentTask.process(this.epochManager);

            this.lastSyncErrored = false;
        } catch (e) {
            if (this.chainReorged || !this.currentTask || this.currentTask.chainReorged) {
                this.warn(`Processing error: ${e}`);

                return;
            }

            const err = e as Error;
            this.panic(
                `Processing error (block: ${this.currentTask.tip}): ${
                    Config.DEV_MODE ? err.stack : err.message
                }`,
            );

            this.addErrorToLog(err);

            const newHeight = this.chainObserver.pendingBlockHeight - 1n;
            if (newHeight > 0n) {
                await this.revertChain(
                    this.chainObserver.pendingBlockHeight,
                    newHeight,
                    'processing-error',
                    false,
                );
            } else {
                mayRestartTask = false;
            }
        } finally {
            this.releaseLockAndCallNextTask(mayRestartTask);
        }
    }

    private addErrorToLog(error: Error): void {
        if (this.lastSyncErrored) return; // Prevent multiple writes of a loop.
        this.lastSyncErrored = true;

        if (!fs.existsSync('error.log')) {
            fs.writeFileSync('error.log', '');
        }

        fs.appendFileSync('error.log', `${new Date().toISOString()} - ${error.stack}\n`);
    }

    private releaseLockAndCallNextTask(mayRestartTask: boolean): void {
        // Task completed.
        this.taskInProgress = false;

        // Release task.
        this.currentTask = undefined;

        if (Config.DEV.PROCESS_ONLY_X_BLOCK) {
            if (this.processedBlocks >= Config.DEV.PROCESS_ONLY_X_BLOCK) {
                return;
            }
        }

        if (!mayRestartTask) {
            this.panic('Please resync the chain from scratch. Something went terribly wrong.');
        } else if (!this.chainReorged) {
            this.startTasks();
        } else {
            this.panic(`Task stopped due to chain reorg.`);
        }
    }

    private async startIndexer(): Promise<ThreadData> {
        if (this.started) {
            return {
                started: false,
                message: 'Indexer already started',
            };
        }

        try {
            await this.init();

            //this.inspector.pause();
        } catch (e) {
            this.panic(`Failed to start indexer: ${e}`);

            return {
                started: false,
                message: `Failed to start indexer: ${e}`,
            };
        }

        return {
            started: true,
        };
    }

    private getCurrentBlock(): CurrentIndexerBlockResponseData {
        return {
            blockNumber: this.chainObserver.pendingBlockHeight,
        };
    }
}
