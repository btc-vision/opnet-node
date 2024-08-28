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

export class SSHThreadManager extends ThreadManager<ThreadTypes.SSH> {
    public readonly logColor: string = '#00f2fa';

    protected readonly threadManager: Threader<ThreadTypes.SSH> = new Threader(ThreadTypes.SSH);

    constructor() {
        super();

        void this.createAllThreads();
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

    protected async onExitRequested(): Promise<void> {
        await this.threadManager.sendToAllThreads({
            type: MessageType.EXIT_THREAD,
        });
    }

    protected async createLinkBetweenThreads(): Promise<void> {
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.INDEXER);
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.API);
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.MEMPOOL);
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.POA);
    }

    private async createAllThreads(): Promise<void> {
        await this.init();

        await this.threadManager.createThreads();
    }
}

new SSHThreadManager();
