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

export class ZeroMQThreadManager extends ThreadManager<ThreadTypes.ZERO_MQ> {
    public readonly logColor: string = '#bc00fa';

    protected readonly threadManager: Threader<ThreadTypes.ZERO_MQ> = new Threader(
        ThreadTypes.ZERO_MQ,
    );

    constructor() {
        super();

        void this.init();
    }

    public sendLinkToZeroMQThread(message: LinkThreadMessage<LinkType>): void {
        throw new Error('Method not implemented.');
    }

    public sendMessageToZeroMQThread(_message: LinkThreadRequestMessage): void {
        throw new Error('Method not implemented.');
    }

    public onGlobalMessage(msg: ThreadMessageBase<MessageType>, thread: Worker): Promise<void> {
        throw new Error('Method not implemented.');
    }

    protected async sendLinkToThreadsOfType(
        threadType: ThreadTypes,
        threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): Promise<boolean> {
        switch (threadType) {
            case ThreadTypes.BITCOIN_RPC: {
                this.sendLinkToZeroMQThread(message);
                return true;
            }
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
            case ThreadTypes.BITCOIN_RPC: {
                this.sendMessageToZeroMQThread(message);
                return true;
            }
            default: {
                return false;
            }
        }
    }

    protected async createLinkBetweenThreads(): Promise<void> {
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.API);
    }
}
