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
import { BitcoinRPC, BlockHeaderInfo } from '@btc-vision/bsi-bitcoin-rpc';
import { ConsensusTracker } from './consensus/ConsensusTracker.js';
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';
import { VMMongoStorage } from '../../vm/storage/databases/VMMongoStorage.js';
import {
    BlockProcessedData,
    BlockProcessedMessage,
} from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import { Network } from 'bitcoinjs-lib';
import { ReorgWatchdog } from './reorg/ReorgWatchdog.js';
import { IReorgData } from '../../db/interfaces/IReorgDocument.js';
import { VMManager } from '../../vm/VMManager.js';
import { SpecialManager } from './special-transaction/SpecialManager.js';

export class BlockIndexer extends Logger {
    public readonly logColor: string = '#00ffe1';

    private chainReorged: boolean = false;

    private readonly database: ConfigurableDBManager = new ConfigurableDBManager(Config);
    private readonly vmStorage: VMStorage = this.getVMStorage();

    private readonly vmManager: VMManager = new VMManager(Config, false, this.vmStorage);
    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly consensusTracker: ConsensusTracker = new ConsensusTracker();
    private readonly specialTransactionManager: SpecialManager = new SpecialManager(this.vmManager);

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

    private readonly network: Network = NetworkConverter.getNetwork();

    private indexingTasks: IndexingTask[] = [];
    private taskInProgress: boolean = false;

    private processedBlocks: number = 0;

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

    public handleMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> | ThreadData | undefined {
        let resp: ThreadData;
        switch (m.type) {
            case MessageType.CURRENT_INDEXER_BLOCK: {
                resp = this.getCurrentBlock();
                break;
            }
            case MessageType.START_INDEXER: {
                resp = this.startIndexer();
                break;
            }
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoA.`);
        }

        return resp ?? undefined;
    }

    private async init(): Promise<void> {
        this.debugBright(`Starting up blockchain indexer thread...`);

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

        // Always purge, in case of bad indexing of the last block.
        const purgeFromBlock = Config.OP_NET.REINDEX
            ? BigInt(Config.OP_NET.REINDEX_FROM_BLOCK)
            : this.chainObserver.pendingBlockHeight;

        this.warn(`Safely purging data from block ${purgeFromBlock}`);

        // Purge.
        const originalHeight = this.chainObserver.pendingBlockHeight;
        await this.vmStorage.revertDataUntilBlock(purgeFromBlock);
        await this.reorgWatchdog.init(originalHeight);

        // If we detect db corruption, we try to restore from the last known good block.
        if (
            this.reorgWatchdog.pendingBlockHeight !== originalHeight &&
            this.reorgWatchdog.pendingBlockHeight !== -1n
        ) {
            this.fail(
                `Reorg watchdog height mismatch: ${this.reorgWatchdog.pendingBlockHeight}. Reverting.`,
            );

            await this.revertChain(
                this.reorgWatchdog.pendingBlockHeight,
                originalHeight,
                'database-corrupted',
                false,
            );
        } else {
            this.startTasks();
        }

        this.registerEvents();
        this.started = true;
    }

    private registerEvents(): void {
        this.blockFetcher.subscribeToBlockChanges((header: BlockHeaderInfo) => {
            if (!this.started) return;

            this.onBlockChange(header);
        });

        this.reorgWatchdog.subscribeToReorgs(
            async (fromHeight: bigint, toHeight: bigint, newBest: string) => {
                await this.revertChain(fromHeight, toHeight, newBest, true);
            },
        );
    }

    private onBlockChange(header: BlockHeaderInfo): void {
        this.reorgWatchdog.onBlockChange(header);
        this.chainObserver.onBlockChange(header);

        if (this.taskInProgress) {
            return;
        }

        if (this.indexingTasks.length === 0) {
            this.startTasks();
        }
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

        // Stop all tasks.
        await this.stopAllTasks(reorged);

        // Notify thread.
        await this.notifyThreadReorg(fromHeight, toHeight, newBest);

        // Await all pending writes.
        await this.vmStorage.killAllPendingWrites();

        // Revert block
        await this.vmStorage.revertDataUntilBlock(fromHeight);
        await this.chainObserver.onChainReorganisation(fromHeight, toHeight, newBest);

        // Revert data.
        if (reorged) await this.reorgFromHeight(fromHeight, toHeight);

        // Unlock tasks.
        this.chainReorged = false;
        this.taskInProgress = false;

        // Start tasks.
        await this.restartTasks();
    }

    private async restartTasks(): Promise<void> {
        if (this.taskInProgress) {
            this.warn(`Task in progress. Waiting for completion.`);

            await this.awaitTaskCompletion();
        }

        // Start tasks.
        this.startTasks();
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

        await this.sendMessageToThread(ThreadTypes.POA, msg);
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

        void this.processNextTask();
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
        if (task.chainReorged) return;

        const processedBlock = task.block;
        if (processedBlock.compromised) {
            this.consensusTracker.lockdown();
        }

        // Update height.
        await this.chainObserver.setNewHeight(task.tip);

        // Notify PoA
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

        // Release task.
        this.currentTask = undefined;

        if (!this.taskInProgress) {
            throw new Error('Database corrupted. Two tasks are running at the same time.');
        }

        if (Config.DEV.PROCESS_ONLY_X_BLOCK) {
            this.processedBlocks++;

            if (this.processedBlocks >= Config.DEV.PROCESS_ONLY_X_BLOCK) {
                return;
            }
        }

        this.taskInProgress = false;

        this.startTasks();
    }

    private async awaitTaskCompletion(): Promise<void> {
        while (this.taskInProgress) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    private async processNextTask(): Promise<void> {
        this.currentTask = this.indexingTasks.shift();
        if (!this.currentTask) {
            return;
        }

        // Mark as in progress.
        this.taskInProgress = true;

        try {
            await this.currentTask.process();
        } catch (e) {
            // Verify if the chain reorged.
            if (this.chainReorged || !this.currentTask || this.currentTask.chainReorged) {
                this.taskInProgress = false;

                this.warn(`Processing error: ${e}`);

                return;
            }

            const error = e as Error;
            this.panic(
                `Processing error (block: ${this.currentTask.tip}): ${Config.DEV_MODE ? error.stack : error.message}`,
            );

            const newHeight = this.chainObserver.pendingBlockHeight - 1n;
            if (newHeight <= 0n) {
                this.panic(`Please resync the chain from scratch. Something went terribly wrong.`);
                return;
            }

            await this.revertChain(
                this.chainObserver.pendingBlockHeight,
                newHeight,
                'processing-error',
                false,
            );
        }
    }

    private startIndexer(): ThreadData {
        if (this.started) {
            return {
                started: false,
                message: 'Indexer already started',
            };
        }

        void this.init();

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
