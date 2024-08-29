import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { BlockIndexer } from './processor/BlockIndexer.js';

export class BlockchainIndexerThread extends Thread<ThreadTypes.INDEXER> {
    public readonly threadType: ThreadTypes.INDEXER = ThreadTypes.INDEXER;

    private readonly blockIndexer: BlockIndexer = new BlockIndexer();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {
        //console.log(`BlockchainIndexerThread: Received message:`, message);
    }

    protected async init(): Promise<void> {
        this.log(`Starting up blockchain indexer thread...`);

        this.blockIndexer.sendMessageToThread = this.sendMessageToThread.bind(this);

        await DBManagerInstance.setup();
        await DBManagerInstance.connect();

        await this.blockIndexer.init();

        this.info(`Blockchain indexer thread started.`);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (type) {
            case ThreadTypes.POA: {
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
