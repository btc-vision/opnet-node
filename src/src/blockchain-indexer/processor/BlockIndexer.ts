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

    private readonly database: ConfigurableDBManager = new ConfigurableDBManager(Config);
    private readonly vmStorage: VMStorage = this.getVMStorage();

    private readonly vmManager: VMManager = new VMManager(Config, false, this.vmStorage);
    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly consensusTracker: ConsensusTracker = new ConsensusTracker();
    private readonly specialTransactionManager: SpecialManager = new SpecialManager(this.vmManager);

    private started: boolean = false;

    private readonly reorgWatchdog: ReorgWatchdog = new ReorgWatchdog(
        this.vmStorage,
        this.vmManager,
        this.rpcClient,
    );

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

    private readonly network: Network = NetworkConverter.getNetwork();

    private indexingTasks: IndexingTask[] = [];
    private taskInProgress: boolean = false;

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

    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async handleMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        let resp: ThreadData;
        switch (m.type) {
            case MessageType.CURRENT_INDEXER_BLOCK: {
                resp = await this.getCurrentBlock();
                break;
            }
            case MessageType.START_INDEXER: {
                resp = await this.startIndexer();
                break;
            }
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoA.`);
        }

        return resp ?? null;
    }

    private async init(): Promise<void> {
        await this.rpcClient.init(Config.BLOCKCHAIN);

        this._blockFetcher = new RPCBlockFetcher({
            maximumPrefetchBlocks: Config.OP_NET.MAXIMUM_PREFETCH_BLOCKS,
            rpc: this.rpcClient,
        });

        await this.vmStorage.init();
        await this.chainObserver.init();

        // First, we check if this node is allowed to write data.
        if (Config.INDEXER.READONLY_MODE) {
            await this.chainObserver.watchBlockchain();
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

        // Purge.
        await this.vmStorage.revertDataUntilBlock(purgeFromBlock);
        await this.reorgWatchdog.init(this.chainObserver.pendingBlockHeight);

        this.registerEvents();

        await this.startAndPurgeIndexer();

        this.started = true;
    }

    private registerEvents(): void {
        this.blockFetcher.subscribeToBlockChanges((header: BlockHeaderInfo) => {
            if (!this.started) return;

            void this.onBlockChange(header);
        });

        this.reorgWatchdog.subscribeToReorgs(
            async (fromHeight: bigint, toHeight: bigint, newBest: string) => {
                await this.onChainReorganisation(fromHeight, toHeight, newBest);
            },
        );
    }

    private async onBlockChange(header: BlockHeaderInfo): Promise<void> {
        this.reorgWatchdog.onBlockChange(header);
        await this.chainObserver.onBlockChange(header);

        if (this.taskInProgress) {
            return;
        }

        if (this.indexingTasks.length === 0) {
            void this.startTasks();
        }
    }

    private async onChainReorganisation(
        fromHeight: bigint,
        toHeight: bigint,
        newBest: string,
    ): Promise<void> {
        this.log(`Chain reorganisation detected: ${fromHeight} -> ${toHeight} - (${newBest})`);

        // Stop all tasks.
        await this.stopAllTasks();

        // Revert block
        await this.chainObserver.setNewHeight(fromHeight);

        this.consensusTracker.setConsensusBlockHeight(fromHeight);

        // Revert data.
        await this.reorgFromHeight(fromHeight, toHeight);
        await this.chainObserver.onChainReorganisation(fromHeight, toHeight, newBest);

        // Start tasks.
        void this.restartTasks();
    }

    private async restartTasks(): Promise<void> {
        if (this.taskInProgress) {
            await this.awaitTaskCompletion();
        }

        // Start tasks.
        await this.startAndPurgeIndexer();
    }

    private async reorgFromHeight(fromHeight: bigint, toBlock: bigint): Promise<void> {
        const reorgData: IReorgData = {
            fromBlock: fromHeight,
            toBlock: toBlock,
            timestamp: new Date(),
        };

        await this.vmStorage.revertDataUntilBlock(fromHeight + 1n);
        await this.vmStorage.setReorg(reorgData);
    }

    private async stopAllTasks(): Promise<void> {
        for (const task of this.indexingTasks) {
            task.cancel();
        }

        this.indexingTasks = [];
    }

    private async verifyCommitConflicts(): Promise<boolean> {
        // TODO: Verify if sync was stopped unexpectedly.

        try {
            //await this.vmStorage.killAllPendingWrites();

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

    private async startAndPurgeIndexer(): Promise<void> {
        try {
            await this.startTasks();
        } catch (e) {
            this.panic(`Error starting tasks: ${e}`);
        }
    }

    private async startTasks(): Promise<void> {
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
        const processedBlock = task.block;
        if (processedBlock.compromised) {
            await this.consensusTracker.lockdown();
        }

        await this.chainObserver.setNewHeight(task.tip);

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

        if (!Config.DEV.PROCESS_ONLY_ONE_BLOCK) {
            void this.startTasks();
        }
    }

    private async awaitTaskCompletion(): Promise<void> {
        while (this.taskInProgress) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    private async processNextTask(): Promise<void> {
        try {
            this.taskInProgress = true;

            const task = this.indexingTasks.shift();
            if (task) {
                await task.process();
            }
        } catch (e) {
            await this.stopAllTasks();

            const error = e as Error;
            this.panic(`Processing error: ${Config.DEV_MODE ? error.stack : error.message}`);

            this.chainObserver.nextBestTip = this.chainObserver.pendingBlockHeight - 3n;
        }

        this.taskInProgress = false;
    }

    private async startIndexer(): Promise<ThreadData> {
        if (Config.P2P.IS_BOOTSTRAP_NODE) {
            return {
                started: true,
            };
        }

        void this.init();

        return {
            started: true,
        };
    }

    private async getCurrentBlock(): Promise<CurrentIndexerBlockResponseData> {
        return {
            blockNumber: this.chainObserver.pendingBlockHeight,
        };
    }
}
