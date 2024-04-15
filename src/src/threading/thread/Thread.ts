import { Logger } from '@btc-vision/bsi-common';
import { MessagePort, parentPort } from 'worker_threads';
import { MessageType } from '../enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../interfaces/thread-messages/messages/LinkThreadMessage.js';
import { SetMessagePort } from '../interfaces/thread-messages/messages/SetMessagePort.js';
import { ThreadMessageResponse } from '../interfaces/thread-messages/messages/ThreadMessageResponse.js';
import { ThreadMessageBase } from '../interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../interfaces/ThreadData.js';
import { ThreadTaskCallback } from '../Threader.js';
import { ThreadTypes } from './enums/ThreadTypes.js';
import { IThread } from './interfaces/IThread.js';

const genRanHex = (size: number) =>
    [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

export abstract class Thread<T extends ThreadTypes> extends Logger implements IThread<T> {
    public abstract readonly threadType: T;

    private messagePort: MessagePort | null = null;
    private tasks: Map<string, ThreadTaskCallback> = new Map<string, ThreadTaskCallback>();

    protected threadRelations: Partial<Record<ThreadTypes, Map<number, MessagePort>>> = {};

    private availableThreads: Partial<Record<ThreadTypes, number>> = {};

    protected constructor() {
        super();

        this.registerEvents();
    }

    public async sendMessageToThread(
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        const relation = this.threadRelations[threadType];

        if (relation) {
            const threadId = this.getNextAvailableThread(threadType);
            const port = relation.get(threadId);

            if (!port) {
                this.error(`Thread not found. {ThreadType: ${threadType}, ThreadId: ${threadId}}`);

                return null;
            }

            return await this.sendMessage(m, port);
        }

        return null;
    }

    private getNextAvailableThread(threadType: ThreadTypes): number {
        let threadId = this.availableThreads[threadType] || 0;

        this.availableThreads[threadType] = threadId + 1;

        const relation = this.threadRelations[threadType];
        const length = relation ? relation.size : 0;

        const keys = relation ? Array.from(relation.keys()) : [];
        this.availableThreads[threadType] = threadId >= length ? 0 : threadId;

        return keys[threadId] || 0;
    }

    protected async sendMessage(
        m: ThreadMessageBase<MessageType>,
        port: MessagePort,
    ): Promise<ThreadData | null> {
        return new Promise<ThreadData | null>((resolve, reject) => {
            try {
                if (!m.taskId) {
                    m.taskId = this.generateTaskId();
                }

                let timeout = setTimeout(() => {
                    this.warn(`Thread task ${m.taskId} timed out.`);

                    resolve(null);
                }, 2400000);

                let task: ThreadTaskCallback = {
                    timeout: timeout,
                    resolve: resolve,
                };

                this.tasks.set(m.taskId, task);
                if (port) {
                    port.postMessage(m);
                } else if (parentPort) parentPort.postMessage(m);
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

            const type = m.data.type;
            const id = type === LinkType.TX ? data.sourceThreadId : data.targetThreadId;
            const relation = this.threadRelations[threadType] || new Map<number, MessagePort>();

            relation.set(id, data.port);

            this.threadRelations[threadType] = relation;

            this.createEvents(threadType, data.port);
            this.important(
                `Thread link created. {ThreadType: ${this.threadType}, SourceThreadType: ${data.sourceThreadType}, LinkType: ${linkType}, ThreadId: ${data.targetThreadId}}`,
            );
        }
    }

    protected async onLinkMessageInternal(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void | ThreadData> {
        switch (m.type) {
            case MessageType.THREAD_RESPONSE: {
                await this.onThreadResponse(m);
                break;
            }
            default: {
                return await this.onLinkMessage(type, m);
            }
        }
    }

    protected abstract onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void | ThreadData>;

    private createEvents(threadType: ThreadTypes, messagePort: MessagePort): void {
        messagePort.on('message', async (m: ThreadMessageBase<MessageType>) => {
            const response = await this.onLinkMessageInternal(threadType, m);

            if (response) {
                const resp: ThreadMessageResponse = {
                    type: MessageType.THREAD_RESPONSE,
                    data: response,
                    taskId: m.taskId,
                    toServer: false,
                };

                await this.sendMessage(resp, messagePort);
            }
        });
    }

    private registerEvents(): void {
        if (parentPort) {
            parentPort.on('message', this.onThreadMessage.bind(this));
            parentPort.on('messageerror', this.onThreadMessageError.bind(this));
        }
    }

    private onThreadMessageError(err: Error): void {
        this.error(`Thread message error {Details: ${err}}`);
    }

    private async onThreadResponse(m: ThreadMessageBase<MessageType>): Promise<void> {
        if (m !== null && m && m.taskId && !m.toServer) {
            let task: ThreadTaskCallback | undefined = this.tasks.get(m.taskId);
            if (task) {
                clearTimeout(task.timeout);

                task.resolve(m.data);
                this.tasks.delete(m.taskId);
            } else {
                this.error(`Thread response task not found. {TaskId: ${m.taskId}}`);
            }
        } else {
            this.error(
                `Thread response doesnt have a task id or sent to server. {TaskId: ${m?.taskId}, ToServer: ${m?.toServer}}`,
            );
        }
    }
}
