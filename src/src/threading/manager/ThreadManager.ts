import { Logger } from '@btc-vision/bsi-common';
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

    public async onThreadSetLinkPort(
        targetThreadType: ThreadTypes,
        targetThreadId: number,
        txMessage: LinkThreadMessage<LinkType>,
    ): Promise<void> {
        await this.threadManager.onThreadSetLinkPort(targetThreadType, targetThreadId, txMessage);
    }

    public async onLinkThread(msg: LinkThreadMessage<LinkType>): Promise<void> {
        const targetThreadType = msg.data.targetThreadType;
        const targetThreadId = msg.data.targetThreadId;

        if (this.threadManager.threadType !== targetThreadType) {
            return;
        }

        await this.threadManager.onThreadSetLinkPort(targetThreadType, targetThreadId, msg);
    }

    public async onLinkThreadRequest(msg: LinkThreadRequestMessage): Promise<void> {
        if (this.threadManager.threadType !== msg.data.threadType) {
            return;
        }

        await this.threadManager.onCreateLinkThreadRequest(msg);
    }

    public async createThreads(): Promise<void> {
        await this.threadManager.createThreads();
    }

    protected init(): void {
        this.threadManager.onGlobalMessage = this.onGlobalMessage.bind(this);
        this.threadManager.sendLinkToThreadsOfType = this.sendLinkToThreadsOfType.bind(this);
        this.threadManager.sendLinkMessageToThreadOfType =
            this.sendLinkMessageToThreadOfType.bind(this);

        this.listenParentManager();

        // TODO: We must fix this. It's a temporary solution. The problem is that if we dont wait, some link might not be created.
        setTimeout(async () => {
            await this.createLinkBetweenThreads();
        }, 6000);
    }

    protected abstract createLinkBetweenThreads(): Promise<void> | void;

    protected abstract sendLinkToThreadsOfType(
        threadType: ThreadTypes,
        threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): Promise<boolean> | boolean;

    protected abstract sendLinkMessageToThreadOfType(
        threadType: ThreadTypes,
        message: LinkThreadRequestMessage,
    ): Promise<boolean> | boolean;

    protected abstract onGlobalMessage(
        msg: ThreadMessageBase<MessageType>,
        thread: Worker,
    ): Promise<void> | void;

    protected abstract onExitRequested(): Promise<void> | void;

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

    private listenParentManager(): void {
        if (parentPort) {
            parentPort.on('message', async (msg: ThreadMessageBase<MessageType>) => {
                if (msg.type === MessageType.EXIT_THREAD) {
                    await this.onExitRequested();
                    return;
                }

                void this.onParentMessage(msg);
            });
        }
    }
}
