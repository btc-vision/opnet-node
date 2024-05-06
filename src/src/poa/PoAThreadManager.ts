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

export class PoAThreadManager extends ThreadManager<ThreadTypes.PoA> {
    public readonly logColor: string = '#00f2fa';

    protected readonly threadManager: Threader<ThreadTypes.PoA> = new Threader(ThreadTypes.PoA);

    constructor() {
        super();

        void this.init();
    }

    public onGlobalMessage(_msg: ThreadMessageBase<MessageType>, _thread: Worker): Promise<void> {
        throw new Error('Method not implemented.');
    }

    /*public async dispatchMessageToThread(
        message: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        return await this.threadManager.execute(message);
    }*/

    protected async sendLinkToThreadsOfType(
        _threadType: ThreadTypes,
        _threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): Promise<boolean> {
        const targetThreadType = message.data.targetThreadType;
        //const targetThreadId = message.data.targetThreadId;

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

    protected async createLinkBetweenThreads(): Promise<void> {
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.BITCOIN_INDEXER);
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.API);
    }
}

const manager = new PoAThreadManager();
void manager.createThreads();
