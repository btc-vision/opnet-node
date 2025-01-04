import { Logger } from '@btc-vision/bsi-common';
import fs from 'fs';
import { MessageChannel, MessagePort, parentPort, Worker, WorkerOptions } from 'worker_threads';
import {
    ServicesConfigurations,
    WorkerConfigurations,
} from '../services/ServicesConfigurations.js';
import { MessageType } from './enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from './interfaces/thread-messages/messages/LinkThreadMessage.js';
import {
    LinkThreadRequestData,
    LinkThreadRequestMessage,
} from './interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { SetMessagePort } from './interfaces/thread-messages/messages/SetMessagePort.js';
import { ThreadMessageBase } from './interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from './interfaces/ThreadData.js';
import { ThreaderConfigurations } from './interfaces/ThreaderConfigurations.js';
import { ThreadTypes } from './thread/enums/ThreadTypes.js';
import { ThreadConfigurations } from './interfaces/ThreadConfigurations.js';
import { FastStringMap } from '../utils/fast/FastStringMap.js';

export type ThreadTaskCallback = {
    timeout: ReturnType<typeof setTimeout>;
    resolve: (value: ThreadData | PromiseLike<ThreadData>) => void;
};

export class Threader<T extends ThreadTypes> extends Logger {
    public logColor: string = '#ff1493';
    public maxInstance: number = 0;

    private readonly target: string | null = null;

    private readonly threads: Worker[] = [];
    private readonly tasks: FastStringMap<ThreadTaskCallback> = new FastStringMap();
    private readonly subChannels: MessageChannel[] = [];

    private currentId: number = 0;

    private linkThreadTypes: ThreadTypes[] = [];

    constructor(public readonly threadType: T) {
        super();

        const config: ThreaderConfigurations = ServicesConfigurations[threadType];
        if (!config) {
            throw new Error('Threader configuration not found.');
        }

        if (typeof config.maxInstance !== 'number') {
            throw new Error('Please specify a valid number of instance to create');
        }

        if (!config.target) {
            throw new Error('Please specify a valid target script.');
        }

        this.maxInstance = config.maxInstance;
        this.target = config.target;
    }

    private get nextThread(): number {
        const id = (this.currentId + 1) % this.threads.length;
        this.currentId = id;

        return id;
    }

    public onGlobalMessage(
        _msg: ThreadMessageBase<MessageType>,
        _thread: Worker,
    ): Promise<void> | void {
        throw new Error('Not implemented.');
    }

    public sendLinkMessageToThreadOfType(
        _threadType: ThreadTypes,
        _message: LinkThreadRequestMessage,
    ): Promise<boolean> | boolean {
        throw new Error('Not implemented.');
    }

    public async onCreateLinkThreadRequest(message: LinkThreadRequestMessage): Promise<void> {
        const data: LinkThreadRequestData = message.data;
        const requestedThreadType = data.threadType;

        if (this.threadType === requestedThreadType) {
            for (const thisThread of this.threads) {
                if (
                    message.data.targetThreadId === thisThread.threadId &&
                    message.data.targetThreadType === this.threadType
                ) {
                    continue;
                }

                await this.createThreadLinkBetween(
                    thisThread,
                    data.targetThreadType,
                    data.targetThreadId,
                    data.mainTargetThreadType,
                    data.mainTargetThreadId,
                );
            }
        } else {
            const success = await this.sendLinkMessageToThreadOfType(requestedThreadType, message);
            if (!success) {
                parentPort?.postMessage(message);
            }
        }
    }

    public async createLinkBetweenThreads(threadType: ThreadTypes): Promise<void> {
        if (this.linkThreadTypes.includes(threadType)) {
            this.warn(`Link between thread type ${threadType} already exists.`);
            return;
        }

        this.linkThreadTypes.push(threadType);

        for (const thread of this.threads) {
            await this.requestThreadLink(thread, threadType);
        }
    }

    public sendLinkToThreadsOfType(
        _threadType: ThreadTypes,
        _threadId: number,
        _message: LinkThreadMessage<LinkType>,
    ): Promise<boolean> | boolean {
        throw new Error('Method not implemented.');
    }

    public async onThreadSetLinkPort(
        targetThreadType: ThreadTypes,
        targetThreadId: number,
        txMessage: LinkThreadMessage<LinkType>,
    ): Promise<void> {
        if (targetThreadType === this.threadType) {
            const thread = this.threads.find((t) => t.threadId === targetThreadId);

            if (thread) {
                thread.postMessage(txMessage, [txMessage.data.port]);
            } else {
                this.warn(
                    `Thread ${targetThreadId} of ${this.threadType}<->${txMessage.data.sourceThreadType} not found.`,
                );
            }
        } else {
            const success = await this.sendLinkToThreadsOfType(
                targetThreadType,
                targetThreadId,
                txMessage,
            );

            if (!success) {
                try {
                    parentPort?.postMessage(txMessage, [txMessage.data.port]);
                } catch (e) {
                    this.error((e as Error).stack as string);
                }
            }
        }
    }

    public executeNoResp(m: ThreadMessageBase<MessageType>): ThreadData | null {
        const selectedThread: Worker = this.threads[this.nextThread];
        if (selectedThread) {
            this.executeMessageOnThreadNoResponse(m, selectedThread);
        }

        return null;
    }

    public async execute(m: ThreadMessageBase<MessageType>): Promise<ThreadData | null> {
        return new Promise(
            (resolve: (value: ThreadData | PromiseLike<ThreadData> | null) => void) => {
                const selectedThread: Worker = this.threads[this.nextThread];

                if (selectedThread) {
                    resolve(this.executeMessageOnThread(m, selectedThread));
                } else {
                    this.warn('No thread available, did something go wrong?');
                    resolve(null);
                }
            },
        );
    }

    public sendToAllThreads(m: ThreadMessageBase<MessageType>): void {
        for (const thread of this.threads) {
            this.executeMessageOnThreadNoResponse(m, thread);
        }
    }

    public createChannel(): { tx: MessagePort; rx: MessagePort } {
        const channel = new MessageChannel();

        return {
            tx: channel.port1,
            rx: channel.port2,
        };
    }

    public async createThreads(): Promise<void> {
        const threads: Promise<Worker | undefined>[] = [];
        for (let i = 0; i < this.maxInstance; i++) {
            threads.push(this.createThread(i));
        }

        await Promise.all(threads);
    }

    public async createThread(i: number): Promise<undefined | Worker> {
        return new Promise((resolve: (value?: Worker | PromiseLike<Worker>) => void) => {
            setTimeout(() => {
                if (!this.target) return;

                const specificConfig: WorkerOptions = WorkerConfigurations[this.threadType];
                const workerOpts: WorkerOptions = {
                    ...ThreadConfigurations.WORKER_OPTIONS,
                    ...specificConfig,
                };

                workerOpts.name = `Thread ${i} - ${this.target
                    .split('/')
                    .reverse()[0]
                    .replace('.js', '')}`;

                const thread: Worker = new Worker(this.target, workerOpts);
                const messageChannel = new MessageChannel();

                this.subChannels[thread.threadId] = messageChannel;

                messageChannel.port2.on('error', () => {
                    this.error('Something went wrong with the message port?');
                });

                messageChannel.port2.on('message', (m: ThreadMessageBase<MessageType>) => {
                    this.onThreadMessage(thread, m);
                });

                thread.on('online', async () => {
                    const msg: SetMessagePort = {
                        type: MessageType.SET_MESSAGE_PORT,
                        data: messageChannel.port1,
                    };

                    thread.postMessage(msg, [messageChannel.port1]);
                    resolve(thread);

                    this.threads.push(thread);

                    await this.linkAllThreads(thread);
                });

                thread.on('message', (m: ThreadMessageBase<MessageType>) => {
                    this.onThreadMessage(thread, m);
                });

                thread.on('exit', (e: Error) => {
                    this.error(`Thread #${i} died. {Target: ${this.target} | ExitCode -> ${e}}`);

                    fs.appendFileSync(
                        'threader.log',
                        `Thread #${i} died. {Target: ${this.target} | ExitCode -> ${e}}\n`,
                    );

                    // remove thread
                    this.threads.splice(i, 1);

                    setTimeout(async () => {
                        this.warn(
                            `!!!!!!!!!!!!!! ------------ Restarting thread #${i}... ------------ !!!!!!!!!!!!!!`,
                        );

                        await this.createThread(i);
                    }, 1000);
                });

                thread.on('error', (e: Error) => {
                    fs.appendFileSync(
                        'threader.log',
                        `Thread #${i} errored. {Target: ${this.target} | Details -> ${e}}\n`,
                    );
                    this.error(`Thread #${i} errored. {Target: ${this.target} | Details: ${e}}`);
                    this.error(e.stack as string);
                    resolve();
                });
            }, i * 200);
        });
    }

    private async createThreadLinkBetween(
        thread: Worker,
        targetThreadType: ThreadTypes,
        targetThreadId: number,
        mainTargetThreadType: ThreadTypes | null = null,
        mainTargetThreadId: number | null = null,
    ): Promise<void> {
        const channel = this.createChannel();

        const rxMessage: LinkThreadMessage<LinkType.RX> = {
            type: MessageType.LINK_THREAD,
            toServer: false,
            data: {
                type: LinkType.RX,
                targetThreadId: thread.threadId,
                sourceThreadId: targetThreadId,

                targetThreadType: this.threadType,
                sourceThreadType: targetThreadType,

                mainTargetThreadType: mainTargetThreadType,
                mainTargetThreadId: mainTargetThreadId,

                port: channel.rx,
            },
        };

        const txMessage: LinkThreadMessage<LinkType.TX> = {
            type: MessageType.LINK_THREAD,
            toServer: false,
            data: {
                type: LinkType.TX,
                targetThreadId: targetThreadId,
                sourceThreadId: thread.threadId,

                targetThreadType: targetThreadType,
                sourceThreadType: this.threadType,

                mainTargetThreadType: mainTargetThreadType,
                mainTargetThreadId: mainTargetThreadId,

                port: channel.tx,
            },
        };

        await this.onThreadSetLinkPort(this.threadType, thread.threadId, rxMessage);
        await this.onThreadSetLinkPort(
            txMessage.data.targetThreadType,
            txMessage.data.targetThreadId,
            txMessage,
        );
    }

    private async requestThreadLink(thread: Worker, targetType: ThreadTypes): Promise<void> {
        const threadId = thread.threadId;
        const m: LinkThreadRequestMessage = {
            type: MessageType.LINK_THREAD_REQUEST,
            toServer: false,
            data: {
                threadType: targetType,
                targetThreadType: this.threadType,
                targetThreadId: threadId,

                mainTargetThreadId: 0,
                mainTargetThreadType: null,
            },
        };

        await this.onCreateLinkThreadRequest(m);
    }

    private onThreadMessage(thread: Worker, m: ThreadMessageBase<MessageType>): void {
        if (m.type === MessageType.LINK_THREAD) {
            //console.log('[THREAD] Link thread message received: ', m);

            return;
        }

        if (m.taskId && !m.toServer) {
            const task: ThreadTaskCallback | undefined = this.tasks.get(m.taskId);

            if (task) {
                clearTimeout(task.timeout);

                task.resolve(m.data);
                this.tasks.delete(m.taskId);
            }
        } else {
            void this.onGlobalMessage(m, thread);
        }
    }

    private async linkAllThreads(thread: Worker): Promise<void> {
        for (const threadType of this.linkThreadTypes) {
            await this.requestThreadLink(thread, threadType);
        }
    }

    private generateRndTaskId(): string {
        return Math.random().toString(36).substring(2);
    }

    private async executeMessageOnThread(
        message: ThreadMessageBase<MessageType>,
        selectedThread: Worker,
    ): Promise<ThreadData> {
        return new Promise((resolve: (value: ThreadData | PromiseLike<ThreadData>) => void) => {
            const taskId: string = this.generateRndTaskId();
            const timeout = setTimeout(() => {
                this.warn(`[A] Thread task ${taskId} timed out.`);

                resolve({
                    error: true,
                });
            }, 30000);

            const task: ThreadTaskCallback = {
                timeout: timeout,
                resolve: resolve,
            };

            if (!message.taskId) {
                message.taskId = taskId;
            }

            this.tasks.set(taskId, task);

            if (this.subChannels[selectedThread.threadId]) {
                this.subChannels[selectedThread.threadId].port2.postMessage(message);
            } else {
                selectedThread.postMessage(message);
            }
        });
    }

    private executeMessageOnThreadNoResponse(
        message: ThreadMessageBase<MessageType>,
        selectedThread: Worker,
    ): void {
        //if (!message.taskId) {
        //    message.taskId = this.generateRndTaskId();
        //}

        if (this.subChannels[selectedThread.threadId]) {
            this.subChannels[selectedThread.threadId].port2.postMessage(message);
        } else {
            selectedThread.postMessage(message);
        }
    }
}
