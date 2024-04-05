import { Logger } from '@btc-vision/motoswapcommon';
import { parentPort, Worker } from 'worker_threads';
import { MessageType } from '../enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { ThreadMessageBase } from '../interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../thread/enums/ThreadTypes.js';
import { Threader } from '../Threader.js';

export abstract class ThreadManager<T extends ThreadTypes> extends Logger {
    protected abstract readonly threadManager: Threader<T>;

    protected constructor() {
        super();
    }

    protected async init(): Promise<void> {
        this.threadManager.onGlobalMessage = this.onGlobalMessage.bind(this);
        this.threadManager.sendLinkToThreadsOfType = this.sendLinkToThreadsOfType.bind(this);
        this.threadManager.sendLinkMessageToThreadOfType =
            this.sendLinkMessageToThreadOfType.bind(this);

        this.listenParentManager();

        await this.createLinkBetweenThreads();
    }

    public async onThreadSetLinkPort(
        targetThreadType: ThreadTypes,
        targetThreadId: number,
        txMessage: LinkThreadMessage<LinkType>,
    ): Promise<void> {
        await this.threadManager.onThreadSetLinkPort(targetThreadType, targetThreadId, txMessage);
    }

    protected abstract createLinkBetweenThreads(): Promise<void>;

    protected abstract sendLinkToThreadsOfType(
        threadType: ThreadTypes,
        threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): Promise<boolean>;

    protected abstract sendLinkMessageToThreadOfType(
        threadType: ThreadTypes,
        message: LinkThreadRequestMessage,
    ): Promise<boolean>;

    protected abstract onGlobalMessage(
        msg: ThreadMessageBase<MessageType>,
        thread: Worker,
    ): Promise<void>;

    private async onParentMessage(msg: ThreadMessageBase<MessageType>): Promise<void> {
        switch (msg.type) {
            case MessageType.LINK_THREAD_REQUEST: {
                await this.onLinkThreadRequest(msg as LinkThreadRequestMessage);
                break;
            }
            case MessageType.LINK_THREAD: {
                await this.onLinkThread(msg as LinkThreadMessage<LinkType>);
                break;
            }
            default: {
                this.error(`[MANAGER] Unknown message type: ${msg.type}`);
                break;
            }
        }
    }

    private async onLinkThread(msg: LinkThreadMessage<LinkType>): Promise<void> {
        const targetThreadType = msg.data.targetThreadType;
        const targetThreadId = msg.data.targetThreadId;

        await this.threadManager.onThreadSetLinkPort(targetThreadType, targetThreadId, msg);
    }

    private async onLinkThreadRequest(msg: LinkThreadRequestMessage): Promise<void> {
        await this.threadManager.onCreateLinkThreadRequest(msg);
    }

    private listenParentManager(): void {
        if (parentPort) {
            parentPort.on('message', (msg: ThreadMessageBase<MessageType>) => {
                void this.onParentMessage(msg);
            });
        }
    }

    public async createThreads(): Promise<void> {
        await this.threadManager.createThreads();
    }
}
