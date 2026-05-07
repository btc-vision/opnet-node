import { Logger } from '@btc-vision/bsi-common';
import { MessagePort, parentPort, threadId } from 'worker_threads';
import { MessageType } from '../enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../interfaces/thread-messages/messages/LinkThreadMessage.js';
import { SetMessagePort } from '../interfaces/thread-messages/messages/SetMessagePort.js';
import { ThreadMessageResponse } from '../interfaces/thread-messages/messages/ThreadMessageResponse.js';
import { UnlinkThreadMessage } from '../interfaces/thread-messages/messages/UnlinkThreadMessage.js';
import { ThreadMessageBase } from '../interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../interfaces/ThreadData.js';
import { ThreadTaskCallback } from '../Threader.js';
import { ThreadTypes } from './enums/ThreadTypes.js';
import { IThread } from './interfaces/IThread.js';
import { Config } from '../../config/Config.js';
import fs from 'fs';
import { FastStringMap } from '../../utils/fast/FastStringMap.js';
import { FastNumberMap } from '../../utils/fast/FastNumberMap.js';

const genRanHex = (size: number) =>
    [...(Array(size) as number[])].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

export type SendMessageToThreadFunction = (
    threadType: ThreadTypes,
    m: ThreadMessageBase<MessageType>,
) => Promise<ThreadData | null>;

export abstract class Thread<T extends ThreadTypes> extends Logger implements IThread<T> {
    public abstract readonly threadType: T;

    protected threadRelations: Partial<Record<ThreadTypes, FastNumberMap<MessagePort>>> = {};
    protected threadRelationsArray: Partial<Record<ThreadTypes, MessagePort[]>> = {};

    private messagePort: MessagePort | null = null;
    private tasks: FastStringMap<ThreadTaskCallback> = new FastStringMap<ThreadTaskCallback>();
    private availableThreads: Partial<Record<ThreadTypes, number>> = {};

    // Tracks the other-end identity for each linked MessagePort so UNLINK_THREAD
    // can identify which port to drop without depending on the (inconsistent)
    // keying of threadRelations across RX/TX link messages.
    private portMeta: Map<MessagePort, { threadType: ThreadTypes; threadId: number }> =
        new Map();

    protected constructor() {
        super();

        this.registerEvents();
    }

    public async sendMessageToThread(
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
        allowRetries: boolean = true,
        i: number = 0,
    ): Promise<ThreadData | null> {
        return new Promise(async (resolve, reject) => {
            try {
                const port = this.getNextAvailableThread(threadType);
                if (port) {
                    const d = await this.sendMessage(m, port, threadType);
                    resolve(d);
                } else if (i !== 5 && allowRetries) {
                    setTimeout(async () => {
                        try {
                            const v = await this.sendMessageToThread(
                                threadType,
                                m,
                                allowRetries,
                                i + 1,
                            );

                            resolve(v);
                        } catch (e: unknown) {
                            reject(e as Error);
                        }
                    }, 500);
                } else {
                    throw new Error(`Thread relation not found. {ThreadType: ${threadType}}`);
                }
            } catch (e) {
                reject(e as Error);
            }
        });
    }

    public async sendMessageToAllThreads(
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
        i: number = 0,
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                const relation = this.threadRelationsArray[threadType];
                if (relation) {
                    const promises: Promise<ThreadData | null>[] = [];
                    for (const port of relation) {
                        promises.push(this.sendMessage({ ...m }, port, threadType));
                    }

                    await Promise.safeAll(promises);
                    resolve();
                } else if (i !== 5) {
                    setTimeout(async () => {
                        const v = await this.sendMessageToAllThreads(threadType, m, i + 1);

                        resolve(v);
                    }, 500);
                } else {
                    reject(new Error(`Thread relation not found. {ThreadType: ${threadType}}`));
                }
            } catch (e) {
                reject(e as Error);
            }
        });
    }

    protected async sendMessage(
        m: ThreadMessageBase<MessageType>,
        port: MessagePort,
        destThreadType?: ThreadTypes,
    ): Promise<ThreadData | null> {
        return new Promise<ThreadData | null>((resolve, reject) => {
            try {
                const hasTaskId = m.taskId !== undefined && m.taskId !== null;
                if (!hasTaskId) {
                    m.taskId = this.generateTaskId();

                    const sentAt = Date.now();
                    const portIndex = destThreadType
                        ? this.threadRelationsArray[destThreadType]?.indexOf(port) ?? -1
                        : -1;

                    const timeout = setTimeout(() => {
                        const ageMs = Date.now() - sentAt;
                        const inflight = this.tasks.size;
                        this.warn(
                            `[B] Thread task ${m.taskId} timed out after ${ageMs}ms. (Thread: ${threadId}, ThreadType: ${this.threadType} -> ${destThreadType ?? 'unknown'} portIdx=${portIndex}, msgType=${m.type}, inflight=${inflight}) - Trace: ${JSON.stringify(m.data)}`,
                        );

                        if (Config.DEV.SAVE_TIMEOUTS_TO_FILE) {
                            fs.appendFileSync(
                                './thread-timeouts.log',
                                `[B] Thread task ${m.taskId} timed out after ${ageMs}ms. (Thread: ${threadId}, ThreadType: ${this.threadType} -> ${destThreadType ?? 'unknown'} portIdx=${portIndex}, msgType=${m.type}, inflight=${inflight}) - Trace: ${JSON.stringify(m)}\n`,
                            );
                        }

                        resolve(null);
                    }, 240_000);

                    const task: ThreadTaskCallback = {
                        timeout: timeout,
                        resolve: resolve,
                        port: port,
                    };

                    this.tasks.set(m.taskId, task);
                }

                if (port) {
                    port.postMessage(m);
                } else if (parentPort) parentPort.postMessage(m);

                if (hasTaskId) {
                    resolve(null);
                }
            } catch (e: unknown) {
                reject(e as Error);
            }
        });
    }

    protected abstract init(): Promise<void> | void;

    protected abstract onMessage(m: ThreadMessageBase<MessageType>): Promise<void>;

    protected async onLinkMessageInternal(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (m.type) {
            case MessageType.THREAD_RESPONSE: {
                this.onThreadResponse(m);
                break;
            }
            default: {
                return this.onLinkMessage(type, m);
            }
        }
    }

    protected abstract onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> | ThreadData | undefined;

    private getNextAvailableThread(threadType: ThreadTypes): MessagePort | null {
        const relation = this.threadRelationsArray[threadType];
        if (!relation || relation.length === 0) {
            return null;
        }

        const currentIndex = (this.availableThreads[threadType] || 0) % relation.length;
        this.availableThreads[threadType] = (currentIndex + 1) % relation.length;

        return relation[currentIndex];
    }

    private generateTaskId(): string {
        return genRanHex(8);
    }

    private setMessagePort(msg: SetMessagePort): void {
        this.messagePort = msg.data;

        this.messagePort.on('message', (msg: ThreadMessageBase<MessageType>) => {
            void this.onThreadMessage(msg);
        });
    }

    private async onThreadMessage(m: ThreadMessageBase<MessageType>): Promise<void> {
        switch (m.type) {
            case MessageType.SET_MESSAGE_PORT:
                this.setMessagePort(m as SetMessagePort);
                break;
            case MessageType.THREAD_RESPONSE:
                this.onThreadResponse(m);
                break;
            case MessageType.LINK_THREAD:
                this.createInternalThreadLink(m as LinkThreadMessage<LinkType>);
                break;
            case MessageType.UNLINK_THREAD:
                this.onUnlinkThread(m as UnlinkThreadMessage);
                break;
            default:
                await this.onMessage(m);
                break;
        }
    }

    private createInternalThreadLink(m: LinkThreadMessage<LinkType>): void {
        const data = m.data;
        const threadType = data.sourceThreadType;

        if (this.threadType !== data.targetThreadType) {
            return;
        }

        const type = m.data.type;
        const id = type === LinkType.TX ? data.sourceThreadId : data.targetThreadId;
        const relation = this.threadRelations[threadType] || new FastNumberMap<MessagePort>();
        relation.set(id, data.port);

        const array = this.threadRelationsArray[threadType] || [];
        if (!array.includes(data.port)) array.push(data.port);

        this.threadRelationsArray[threadType] = array;
        this.threadRelations[threadType] = relation;

        // sourceThreadType / sourceThreadId always describe the OTHER end of the
        // link from this thread's perspective, regardless of TX/RX direction.
        this.portMeta.set(data.port, {
            threadType: data.sourceThreadType,
            threadId: data.sourceThreadId,
        });

        this.createEvents(threadType, data.port);
    }

    /**
     * Drop every link to a worker that just died.
     *
     * Without this, the dead MessagePort lingers in threadRelations /
     * threadRelationsArray and every subsequent send to that port stalls until
     * the 240s sendMessage timeout fires — and on broadcast paths
     * (sendMessageToAllThreads) the slowest dead port poisons the whole call.
     * In-flight tasks pinned to the dead port are also resolved here so callers
     * unblock immediately instead of waiting out their own 240s timer.
     */
    private onUnlinkThread(m: UnlinkThreadMessage): void {
        const { threadType, threadId } = m.data;

        const deadPorts: MessagePort[] = [];
        for (const [port, meta] of this.portMeta) {
            if (meta.threadType === threadType && meta.threadId === threadId) {
                deadPorts.push(port);
            }
        }

        if (deadPorts.length === 0) return;

        for (const port of deadPorts) {
            this.portMeta.delete(port);

            const array = this.threadRelationsArray[threadType];
            if (array) {
                const idx = array.indexOf(port);
                if (idx >= 0) array.splice(idx, 1);
            }

            const relation = this.threadRelations[threadType];
            if (relation) {
                for (const [k, v] of relation.entries()) {
                    if (v === port) relation.delete(k);
                }
            }

            try {
                port.close();
            } catch {
                // closing an already-disposed port is harmless; ignore.
            }
        }

        const deadSet = new Set(deadPorts);
        let cancelled = 0;
        for (const taskId of [...this.tasks.keys()]) {
            const task = this.tasks.get(taskId);
            if (task && task.port && deadSet.has(task.port)) {
                clearTimeout(task.timeout);
                task.resolve(null);
                this.tasks.delete(taskId);
                cancelled++;
            }
        }

        // Reset round-robin cursor so we don't read past the new (shorter) array.
        this.availableThreads[threadType] = 0;

        this.warn(
            `Unlinked dead ${threadType}#${threadId}: dropped ${deadPorts.length} port(s), cancelled ${cancelled} pending task(s).`,
        );
    }

    private async onEventMessage(
        m: ThreadMessageBase<MessageType>,
        threadType: ThreadTypes,
        messagePort: MessagePort,
    ): Promise<void> {
        let response: ThreadData | undefined;

        try {
            response = await this.onLinkMessageInternal(threadType, m);
        } catch (e) {
            this.error(`Error processing event message. {Details: ${e}}`);
        }

        if (m.taskId && response != undefined) {
            const resp: ThreadMessageResponse = {
                type: MessageType.THREAD_RESPONSE,
                data: response,
                taskId: m.taskId,
                toServer: false,
            };

            await this.sendMessage(resp, messagePort);
        }
    }

    private createEvents(threadType: ThreadTypes, messagePort: MessagePort): void {
        messagePort.on('message', (m: ThreadMessageBase<MessageType>) => {
            void this.onEventMessage(m, threadType, messagePort);
        });
    }

    private registerEvents(): void {
        if (parentPort) {
            parentPort.on('message', (m: ThreadMessageBase<MessageType>) => {
                void this.onThreadMessage(m);
            });
            parentPort.on('messageerror', this.onThreadMessageError.bind(this));
        }
    }

    private onThreadMessageError(err: Error): void {
        this.error(`Thread message error {Details: ${err}}`);
    }

    private onThreadResponse(m: ThreadMessageBase<MessageType>): void {
        if (m !== null && m && m.taskId && !m.toServer) {
            const task: ThreadTaskCallback | undefined = this.tasks.get(m.taskId);
            if (task) {
                this.tasks.delete(m.taskId);

                clearTimeout(task.timeout);
                task.resolve(m.data);
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
