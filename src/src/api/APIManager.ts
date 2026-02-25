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

export class APIManager extends ThreadManager<ThreadTypes.API> {
    public logColor: string = '#bc00fa';

    protected readonly threadManager: Threader<ThreadTypes.API> = new Threader(ThreadTypes.API);

    constructor() {
        super();

        this.init();
    }

    protected onGlobalMessage(msg: ThreadMessageBase<MessageType>, _thread: Worker): void {
        switch (msg.type) {
            default: {
                throw new Error('Unknown message type.');
            }
        }
    }

    protected async createLinkBetweenThreads(): Promise<void> {
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.API);
    }

    protected sendLinkToThreadsOfType(
        threadType: ThreadTypes,
        _threadId: number,
        _message: LinkThreadMessage<LinkType>,
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
}

const apiManager = new APIManager();
await apiManager.createThreads();
