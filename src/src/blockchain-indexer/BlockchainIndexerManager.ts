import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { ZeroMQThreadManager } from './zeromq/thread/ZeroMQThreadManager.js';

class BlockchainIndexerManager extends Thread<ThreadTypes.BITCOIN_INDEXER> {
    public readonly threadType: ThreadTypes.BITCOIN_INDEXER = ThreadTypes.BITCOIN_INDEXER;
    public readonly logColor: string = '#1553c7';

    public readonly zeroMQThreads: ZeroMQThreadManager = new ZeroMQThreadManager();

    constructor() {
        super();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        this.log(`Starting up blockchain indexer manager...`);

        await DBManagerInstance.setup(Config.DATABASE.CONNECTION_TYPE);
        await DBManagerInstance.connect();

        await this.zeroMQThreads.createThreads();
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        msg: ThreadMessageBase<MessageType>,
    ): Promise<void> {}
}

new BlockchainIndexerManager();
