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

export class BroadcastThreadManager extends ThreadManager<ThreadTypes.BROADCAST> {
    public readonly logColor: string = '#ff8c00';

    protected readonly threadManager: Threader<ThreadTypes.BROADCAST> = new Threader(
        ThreadTypes.BROADCAST,
    );

    constructor() {
        super();
        void this.createAllThreads();
    }

    public onGlobalMessage(_msg: ThreadMessageBase<MessageType>, _thread: Worker): Promise<void> {
        throw new Error('Method not implemented.');
    }

    protected sendLinkToThreadsOfType(
        _threadType: ThreadTypes,
        _threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): Promise<boolean> | boolean {
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
    ): Promise<boolean> | boolean {
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
        // Link to API: receives forwarded BROADCAST_TRANSACTION_OPNET requests.
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.API);
        // Link to P2P: forwards the publish to the libp2p node that lives there.
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.P2P);
    }

    private async createAllThreads(): Promise<void> {
        this.init();
        await this.threadManager.createThreads();
    }
}

new BroadcastThreadManager();
