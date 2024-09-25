import { Worker } from 'worker_threads';
import { ThreadManager } from '../../../../threading/manager/ThreadManager.js';
import { Threader } from '../../../../threading/Threader.js';
import { ThreadTypes } from '../../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../../threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../../../../threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../../../../threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';

class BitcoinMempoolManager extends ThreadManager<ThreadTypes.MEMPOOL_MANAGER> {
    public readonly logColor: string = '#00f2fa';

    protected readonly threadManager: Threader<ThreadTypes.MEMPOOL_MANAGER> = new Threader(
        ThreadTypes.MEMPOOL_MANAGER,
    );

    constructor() {
        super();

        void this.createMempoolThreads();
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
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.MEMPOOL);
    }

    private async createMempoolThreads(): Promise<void> {
        await this.createThreads();
        this.init();
    }
}

new BitcoinMempoolManager();
