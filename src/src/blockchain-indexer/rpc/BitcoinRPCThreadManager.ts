import { Worker } from 'worker_threads';
import { MessageType } from '../../threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../../threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../../threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadManager } from '../../threading/manager/ThreadManager.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { Threader } from '../../threading/Threader.js';

export class BitcoinRPCThreadManager extends ThreadManager<ThreadTypes.BITCOIN_RPC> {
    public readonly logColor: string = '#bc00fa';

    protected readonly threadManager: Threader<ThreadTypes.BITCOIN_RPC> = new Threader(
        ThreadTypes.BITCOIN_RPC,
    );

    constructor() {
        super();

        void this.init();
    }

    public sendLinkToZeroMQThread(_message: LinkThreadMessage<LinkType>): void {
        throw new Error('Method not implemented.');
    }

    public sendMessageToZeroMQThread(_message: LinkThreadRequestMessage): void {
        throw new Error('Method not implemented.');
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
        message: LinkThreadRequestMessage,
    ): Promise<boolean> {
        switch (threadType) {
            case ThreadTypes.ZERO_MQ: {
                this.sendMessageToZeroMQThread(message);
                return true;
            }
            default: {
                return false;
            }
        }
    }

    protected async createLinkBetweenThreads(): Promise<void> {
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.MEMPOOL);
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.PoA);
        //await this.threadManager.createLinkBetweenThreads(ThreadTypes.ZERO_MQ);
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.API);
    }
}
