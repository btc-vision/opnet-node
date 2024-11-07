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

class BlockchainIndexerManager extends ThreadManager<ThreadTypes.INDEXER> {
    public readonly logColor: string = '#1553c7';

    protected readonly threadManager: Threader<ThreadTypes.INDEXER> = new Threader(
        ThreadTypes.INDEXER,
    );

    private readonly bitcoinRPCThreads: BitcoinRPCThreadManager = new BitcoinRPCThreadManager();

    constructor() {
        super();

        void this.init();
    }

    public onGlobalMessage(_msg: ThreadMessageBase<MessageType>, _thread: Worker): Promise<void> {
        throw new Error('Method not implemented.');
    }

    protected sendLinkToThreadsOfType(
        _threadType: ThreadTypes,
        _threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): boolean {
        const targetThreadType = message.data.targetThreadType;

        switch (targetThreadType) {
            default: {
                return false;
            }
        }
    }

    protected sendLinkMessageToThreadOfType(
        threadType: ThreadTypes,
        _message: LinkThreadRequestMessage,
    ): boolean {
        switch (threadType) {
            default: {
                return false;
            }
        }
    }

    protected onExitRequested(): void {
        this.threadManager.sendToAllThreads({
            type: MessageType.EXIT_THREAD,
        });
    }

    protected async createLinkBetweenThreads(): Promise<void> {
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.P2P);
    }

    protected async init(): Promise<void> {
        super.init();

        this.important('Creating threads for bitcoin-rpc...');
        await this.bitcoinRPCThreads.createThreads();

        this.log('Starting block indexer...');
        await this.createThreads();
    }
}

new BlockchainIndexerManager();
