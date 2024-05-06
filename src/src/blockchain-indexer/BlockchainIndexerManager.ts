import { Worker } from 'worker_threads';
import { MessageType } from '../threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadManager } from '../threading/manager/ThreadManager.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Threader } from '../threading/Threader.js';
import { BitcoinRPCThreadManager } from './rpc/BitcoinRPCThreadManager.js';
import { ZeroMQThreadManager } from './zeromq/ZeroMQThreadManager.js';

class BlockchainIndexerManager extends ThreadManager<ThreadTypes.BITCOIN_INDEXER> {
    public readonly logColor: string = '#1553c7';
    protected readonly threadManager: Threader<ThreadTypes.BITCOIN_INDEXER> = new Threader(
        ThreadTypes.BITCOIN_INDEXER,
    );

    private readonly zeroMQThreads: ZeroMQThreadManager = new ZeroMQThreadManager();
    private readonly bitcoinRPCThreads: BitcoinRPCThreadManager = new BitcoinRPCThreadManager();

    constructor() {
        super();

        this.zeroMQThreads.sendMessageToZeroMQThread =
            this.sendMessageToBitcoinRPCThread.bind(this);
        this.zeroMQThreads.sendLinkToZeroMQThread = this.sendLinkToBitcoinRPCThread.bind(this);

        this.bitcoinRPCThreads.sendMessageToZeroMQThread =
            this.sendMessageToZeroMQThread.bind(this);
        this.bitcoinRPCThreads.sendLinkToZeroMQThread = this.sendLinkToZeroMQThread.bind(this);

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

    public onGlobalMessage(_msg: ThreadMessageBase<MessageType>, _thread: Worker): Promise<void> {
        throw new Error('Method not implemented.');
    }

    protected async sendLinkToThreadsOfType(
        _threadType: ThreadTypes,
        _threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): Promise<boolean> {
        const targetThreadType = message.data.targetThreadType;

        switch (targetThreadType) {
            default: {
                return false;
            }
        }
    }

    protected async sendLinkMessageToThreadOfType(
        threadType: ThreadTypes,
        _message: LinkThreadRequestMessage,
    ): Promise<boolean> {
        switch (threadType) {
            default: {
                return false;
            }
        }
    }

    protected async createLinkBetweenThreads(): Promise<void> {}

    protected async init(): Promise<void> {
        await super.init();

        this.important('Creating threads for ZeroMQ...');
        await this.zeroMQThreads.createThreads();

        this.important('Creating threads for bitcoin-rpc...');
        await this.bitcoinRPCThreads.createThreads();

        this.log('Starting block indexer...');
        await this.createThreads();
    }
}

new BlockchainIndexerManager();
