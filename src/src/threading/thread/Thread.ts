import { Logger } from '@btc-vision/motoswapcommon';
import { MessagePort, parentPort } from 'worker_threads';
import { MessageType } from '../enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../interfaces/thread-messages/messages/LinkThreadMessage.js';
import { SetMessagePort } from '../interfaces/thread-messages/messages/SetMessagePort.js';
import { ThreadMessageBase } from '../interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../interfaces/ThreadData.js';
import { ThreadTaskCallback } from '../Threader.js';
import { ThreadTypes } from './enums/ThreadTypes.js';
import { IThread } from './interfaces/IThread.js';

const genRanHex = (size: any) =>
    [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

export abstract class Thread<T extends ThreadTypes> extends Logger implements IThread<T> {
    public abstract readonly threadType: T;

    private messagePort: MessagePort | null = null;
    private tasks: Map<string, ThreadTaskCallback> = new Map<string, ThreadTaskCallback>();

    private threadRelations: Partial<Record<ThreadTypes, Map<number, MessagePort>>> = {};

    protected constructor() {
        super();

        this.registerEvents();
    }

    protected async sendMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData | null> {
        return new Promise<ThreadData | null>((resolve, reject) => {
            try {
                let taskId = this.generateTaskId();
                m.taskId = taskId;

                let timeout = setTimeout(() => {
                    this.warn(`Thread task ${taskId} timed out.`);

                    resolve(null);
                }, 2400000);

                let task: ThreadTaskCallback = {
                    timeout: timeout,
                    resolve: resolve,
                };

                this.tasks.set(m.taskId, task);
                if (parentPort) parentPort.postMessage(m);
            } catch (e) {
                reject(e);
            }
        });
    }

    protected abstract init(): Promise<void>;

    protected abstract onMessage(m: ThreadMessageBase<MessageType>): Promise<void>;

    private generateTaskId(): string {
        return genRanHex(8);
    }

    private setMessagePort(msg: SetMessagePort): void {
        this.messagePort = msg.data;

        this.messagePort.on('message', async (msg: ThreadMessageBase<MessageType>) => {
            await this.onThreadMessage(msg);
        });
    }

    private async onThreadMessage(m: ThreadMessageBase<MessageType>): Promise<void> {
        switch (m.type) {
            case MessageType.SET_MESSAGE_PORT:
                this.setMessagePort(m as SetMessagePort);
                break;
            case MessageType.THREAD_RESPONSE:
                await this.onThreadResponse(m);
                break;
            case MessageType.LINK_THREAD:
                this.createInternalThreadLink(m as LinkThreadMessage<LinkType>);
                break;
            default:
                await this.onMessage(m);
                break;
        }
    }

    /*protected abstract createLinkBetweenThreads(
        threadType: ThreadTypes,
        m: LinkThreadMessage<LinkType>,
    ): Promise<void>;*/

    private createInternalThreadLink(m: LinkThreadMessage<LinkType>): void {
        this.log('Creating internal thread link...');

        const data = m.data;
        const linkType = data.type;
        const threadType = data.sourceThreadType;

        if (data.mainTargetThreadType === this.threadType) {
            //void this.createLinkBetweenThreads(data.targetThreadType, m);
        } else {
            if (this.threadType !== data.targetThreadType) {
                throw new Error(
                    `Thread type mismatch. {ThreadType: ${this.threadType}, SourceThreadType: ${threadType}}`,
                );
            }

            const relation = this.threadRelations[threadType] || new Map<number, MessagePort>();
            relation.set(data.targetThreadId, data.port);

            this.threadRelations[threadType] = relation;

            this.createEvents(threadType, data.port);

            this.important(
                `Thread link created. {ThreadType: ${this.threadType}, SourceThreadType: ${data.sourceThreadType}, LinkType: ${linkType}, ThreadId: ${data.targetThreadId}}`,
            );
        }
    }

    protected abstract onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void>;

    private createEvents(threadType: ThreadTypes, messagePort: MessagePort): void {
        messagePort.on('message', (m: ThreadMessageBase<MessageType>) => {
            void this.onLinkMessage(threadType, m);
        });
    }

    private registerEvents(): void {
        if (parentPort) {
            parentPort.on('message', this.onThreadMessage.bind(this));
            parentPort.on('messageerror', this.onThreadMessageError.bind(this));
        }
    }

    private onThreadMessageError(m: any): void {
        this.error(`Thread message error {Details: ${m}}`);
    }

    private async onThreadResponse(m: ThreadMessageBase<MessageType>): Promise<void> {
        if (m !== null && m && m.taskId && !m.toServer) {
            let task: ThreadTaskCallback | undefined = this.tasks.get(m.taskId);
            if (task) {
                clearTimeout(task.timeout);

                task.resolve(m.data);
                this.tasks.delete(m.taskId);
            }
        } else {
            this.error(
                `Thread response doesnt have a task id or sent to server. {TaskId: ${m?.taskId}, ToServer: ${m?.toServer}}`,
            );
        }
    }
}
