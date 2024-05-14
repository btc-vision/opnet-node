import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
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

        /**
         * Make sure that other threads are setup before starting the Indexer.
         */
        setTimeout(async () => {
            await this.blockIndexer.start();

            this.info(`Blockchain indexer thread started.`);
        }, 6000);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (type) {
            case ThreadTypes.PoA: {
                return await this.onPoAMessage(m);
            }

            default:
                throw new Error(
                    `Unknown message type: ${type} received in BlockchainIndexerThread.`,
                );
        }
    }

    private async onPoAMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData | undefined> {
        return await this.blockIndexer.handleBitcoinIndexerMessage(m);
    }
}

new BlockchainIndexerThread();
