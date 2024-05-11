import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { BlockchainIndexer } from './processor/BlockchainIndexer.js';

export class BlockchainIndexerThread extends Thread<ThreadTypes.BITCOIN_INDEXER> {
    public readonly threadType: ThreadTypes.BITCOIN_INDEXER = ThreadTypes.BITCOIN_INDEXER;

    private readonly blockIndexer: BlockchainIndexer = new BlockchainIndexer(Config);

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(message: ThreadMessageBase<MessageType>): Promise<void> {
        console.log(`BlockchainIndexerThread: Received message:`, message);
    }

    protected async init(): Promise<void> {
        this.log(`Starting up blockchain indexer thread...`);

        this.blockIndexer.sendMessageToThread = this.sendMessageToThread.bind(this);

        await DBManagerInstance.setup(Config.DATABASE.CONNECTION_TYPE);
        await DBManagerInstance.connect();

        setTimeout(() => {
            void this.blockIndexer.start();

            this.info(`Blockchain indexer thread started.`);
        }, 7000);
    }

    protected async onLinkMessage(
        _type: ThreadTypes,
        _m: ThreadMessageBase<MessageType>,
    ): Promise<void> {}
}

new BlockchainIndexerThread();
