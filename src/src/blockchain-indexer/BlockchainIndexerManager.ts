import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { BlockIndexer } from './processor/BlockIndexer.js';
import { BitcoinRPCThreadManager } from './rpc/BitcoinRPCThreadManager.js';
import { ZeroMQThreadManager } from './zeromq/ZeroMQThreadManager.js';

class BlockchainIndexerManager extends Thread<ThreadTypes.BITCOIN_INDEXER> {
    public readonly threadType: ThreadTypes.BITCOIN_INDEXER = ThreadTypes.BITCOIN_INDEXER;
    public readonly logColor: string = '#1553c7';

    public readonly zeroMQThreads: ZeroMQThreadManager = new ZeroMQThreadManager();
    public readonly bitcoinRPCThreads: BitcoinRPCThreadManager = new BitcoinRPCThreadManager();

    private readonly blockIndexer: BlockIndexer = new BlockIndexer();

    constructor() {
        super();

        this.zeroMQThreads.sendMessageToZeroMQThread =
            this.sendMessageToBitcoinRPCThread.bind(this);
        this.zeroMQThreads.sendLinkToZeroMQThread = this.sendLinkToBitcoinRPCThread.bind(this);

        this.bitcoinRPCThreads.sendMessageToZeroMQThread =
            this.sendMessageToZeroMQThread.bind(this);

        this.bitcoinRPCThreads.sendLinkToZeroMQThread = this.sendLinkToZeroMQThread.bind(this);

        this.blockIndexer.sendMessageToThread = this.sendMessageToThread.bind(this);

        void this.init();
    }

    public sendLinkToZeroMQThread(message: LinkThreadMessage<LinkType>): void {
        void this.zeroMQThreads.onLinkThread(message);
    }

    public sendMessageToZeroMQThread(_message: LinkThreadRequestMessage): void {
        void this.zeroMQThreads.onLinkThreadRequest(_message);
    }

    public sendLinkToBitcoinRPCThread(message: LinkThreadMessage<LinkType>): void {
        void this.bitcoinRPCThreads.onLinkThread(message);
    }

    public sendMessageToBitcoinRPCThread(_message: LinkThreadRequestMessage): void {
        void this.bitcoinRPCThreads.onLinkThreadRequest(_message);
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        this.log(`Starting up blockchain indexer manager...`);

        await DBManagerInstance.setup(Config.DATABASE.CONNECTION_TYPE);
        await DBManagerInstance.connect();

        this.important('Creating threads for ZeroMQ...');
        await this.zeroMQThreads.createThreads();

        this.important('Creating threads for bitcoin-rpc...');
        await this.bitcoinRPCThreads.createThreads();

        this.log('Starting block indexer...');
        setTimeout(() => {
            void this.blockIndexer.start();
        }, 2000);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        msg: ThreadMessageBase<MessageType>,
    ): Promise<void> {}

    /*private async sendMessageToThreadMaster(
        _threadType: ThreadTypes,
        _m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        switch (_threadType) {
            case ThreadTypes.BITCOIN_RPC: {
                return await this.bitcoinRPCThreads.dispatchMessageToThread(_m);
            }
            default: {
                return null;
            }
        }
    }*/
}

new BlockchainIndexerManager();
