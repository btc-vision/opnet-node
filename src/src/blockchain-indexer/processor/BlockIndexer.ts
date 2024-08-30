import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { ReorgWatchdog } from './reorg/ReorgWatchdog.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { Config } from '../../config/Config.js';
import { RPCBlockFetcher } from '../fetcher/RPCBlockFetcher.js';
import { CurrentIndexerBlockResponseData } from '../../threading/interfaces/thread-messages/messages/indexer/CurrentIndexerBlock.js';
import { BlockObserver } from './observer/BlockObserver.js';
import { IndexingTask } from './indexer/IndexingTask.js';
import { BlockFetcher } from '../fetcher/abstract/BlockFetcher.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
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

export class BlockIndexer extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly reorgWatchdog: ReorgWatchdog = new ReorgWatchdog();

    private readonly database: ConfigurableDBManager = new ConfigurableDBManager(Config);

    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly consensusTracker: ConsensusTracker = new ConsensusTracker();
    private readonly vmStorage: VMStorage = this.getVMStorage();

    private readonly blockObserver: BlockObserver = new BlockObserver(
        Config.BITCOIN.NETWORK,
        this.database,
        this.rpcClient,
        this.consensusTracker,
        this.vmStorage,
    );

    private readonly network: Network = NetworkConverter.getNetwork();

    private indexingTasks: IndexingTask[] = [];

    constructor() {
        super();

        this.blockObserver.notifyBlockProcessed = this.notifyBlockProcessed.bind(this);
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

    public async init(): Promise<void> {
        this._blockFetcher = new RPCBlockFetcher({
            maximumPrefetchBlocks: Config.OP_NET.MAXIMUM_PREFETCH_BLOCKS,
            rpc: this.rpcClient,
        });
    }

    private async verifyCommitConflicts(): Promise<void> {
        // TODO: Verify if sync was stopped unexpectedly.

        await this.vmStorage.killAllPendingWrites();
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

    private async notifyBlockNotifier(): Promise<void> {
        await this.sendMessageToThread(ThreadTypes.SYNCHRONISATION, {
            type: MessageType.START_INDEXER,
        });
    }

    private async startAndPurgeIndexer(): Promise<void> {
        // First, we check if this node is allowed to write data.
        if (Config.INDEXER.READONLY_MODE) {
            await this.blockObserver.watchBlockchain();
            return;
        }

        await this.verifyCommitConflicts();

        this.info(`Starting up block indexer...`);
    }

    private async startIndexer(): Promise<ThreadData> {
        this.info(`Blockchain indexer thread started.`);

        if (Config.P2P.IS_BOOTSTRAP_NODE) {
            return {
                started: true,
            };
        }

        await this.notifyBlockNotifier();
        void this.startAndPurgeIndexer();

        return {
            started: true,
        };
    }

    private async getCurrentBlock(): Promise<CurrentIndexerBlockResponseData> {
        return {
            blockNumber: this.blockObserver.currentBlockHeight,
        };
    }
}
