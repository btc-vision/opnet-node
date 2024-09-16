import { ThreadManager } from '../../threading/manager/ThreadManager.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { Threader } from '../../threading/Threader.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../../threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../../threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { Worker } from 'worker_threads';

class SynchronisationManager extends ThreadManager<ThreadTypes.SYNCHRONISATION> {
    public readonly logColor: string = '#1553c7';

    protected readonly threadManager: Threader<ThreadTypes.SYNCHRONISATION> = new Threader(
        ThreadTypes.SYNCHRONISATION,
    );

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
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.INDEXER);
    }

    protected async init(): Promise<void> {
        super.init();

        this.log('Starting block indexer...');
        await this.createThreads();
    }
}

new SynchronisationManager();
