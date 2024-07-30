import { Logger } from '@btc-vision/bsi-common';
import { MessagePort, parentPort, threadId } from 'worker_threads';
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

    protected threadRelations: Partial<Record<ThreadTypes, Map<number, MessagePort>>> = {};
    protected threadRelationsArray: Partial<Record<ThreadTypes, MessagePort[]>> = {};

    private messagePort: MessagePort | null = null;
    private tasks: Map<string, ThreadTaskCallback> = new Map<string, ThreadTaskCallback>();
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
            const port = this.getNextAvailableThread(threadType);

            if (!port) {
                this.error(`Thread not found. {ThreadType: ${threadType}}`);

                return null;
            }

            return await this.sendMessage(m, port);
        } else {
            throw new Error(`Thread relation not found. {ThreadType: ${threadType}}`);
        }
    }

    protected async sendMessage(
        m: ThreadMessageBase<MessageType>,
        port: MessagePort,
    ): Promise<ThreadData | null> {
        return new Promise<ThreadData | null>((resolve, reject) => {
            try {
                const hasTaskId = m.taskId !== undefined && m.taskId !== null;
                if (!hasTaskId) {
                    m.taskId = this.generateTaskId();

                    const timeout = setTimeout(() => {
                        this.warn(
                            `[B] Thread task ${m.taskId} timed out. (Thread: ${threadId}, ThreadType: ${this.threadType})`,
                        );

                        resolve(null);
                    }, 12_000);

                    const task: ThreadTaskCallback = {
                        timeout: timeout,
                        resolve: resolve,
                    };

                    this.tasks.set(m.taskId, task);
                }

                if (port) {
                    port.postMessage(m);
                } else if (parentPort) parentPort.postMessage(m);

                if (hasTaskId) {
                    resolve(null);
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    protected abstract init(): Promise<void>;

    protected abstract onMessage(m: ThreadMessageBase<MessageType>): Promise<void>;

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

    private getNextAvailableThread(threadType: ThreadTypes): MessagePort {
        const relation = this.threadRelationsArray[threadType];
        if (!relation) {
            throw new Error(`Thread relation not found. {ThreadType: ${threadType}}`);
        }

        let currentIndex = this.availableThreads[threadType] || 0;
        this.availableThreads[threadType] = (currentIndex + 1) % relation.length;

        return relation[currentIndex];
    }

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

    private createInternalThreadLink(m: LinkThreadMessage<LinkType>): void {
        const data = m.data;
        const linkType = data.type;
        const threadType = data.sourceThreadType;

        if (this.threadType !== data.targetThreadType) {
            /*throw new Error(
                `Thread type ${this.threadType} is not the target thread type ${data.targetThreadType}.`,
            );*/

            return;
        }

        const type = m.data.type;
        const id = type === LinkType.TX ? data.sourceThreadId : data.targetThreadId;
        const relation = this.threadRelations[threadType] || new Map<number, MessagePort>();
        relation.set(id, data.port);

        const array = this.threadRelationsArray[threadType] || [];
        if (!array.includes(data.port)) array.push(data.port);

        this.threadRelationsArray[threadType] = array;
        this.threadRelations[threadType] = relation;

        this.createEvents(threadType, data.port);
        /*this.important(
            `Thread link created. {ThreadType: ${this.threadType}, SourceThreadType: ${data.sourceThreadType}, LinkType: ${linkType}, ThreadId: ${data.targetThreadId}}`,
        );*/
    }

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
