import { Logger, UtilsConfigurations } from '@btc-vision/motoswapcommon';
import fs from 'fs';
import { MessageChannel, Worker } from 'worker_threads';
import { MessageType } from './enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from './interfaces/thread-messages/messages/LinkThreadMessage.js';
import { SetMessagePort } from './interfaces/thread-messages/messages/SetMessagePort.js';
import { ThreadMessageBase } from './interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from './interfaces/ThreadData.js';
import { ThreaderConfigurations } from './interfaces/ThreaderConfigurations.js';

export type ThreadTaskCallback = {
    timeout: ReturnType<typeof setTimeout>;
    resolve: (value: ThreadData | PromiseLike<ThreadData>) => void;
};

export class Threader extends Logger {
    public logColor: string = '#ff1493';
    public maxInstance: number = 0;

    private readonly target: string | null = null;

    private readonly threads: Worker[] = [];
    private readonly tasks: Map<string, ThreadTaskCallback> = new Map<string, ThreadTaskCallback>();
    private readonly subChannels: MessageChannel[] = [];

    private currentId: number = 0;

    constructor(config: ThreaderConfigurations) {
        super();

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
        let id = (this.currentId + 1) % this.threads.length;

        this.currentId = id;

        return id;
    }

    public async onGlobalMessage(
        msg: ThreadMessageBase<MessageType>,
        thread: Worker,
    ): Promise<void> {
        throw new Error('Not implemented.');
    }

    public onThreadMessage(thread: Worker, m: ThreadMessageBase<MessageType>): void {
        if (m.taskId && !m.toServer) {
            let task: ThreadTaskCallback | undefined = this.tasks.get(m.taskId);

            if (task) {
                clearTimeout(task.timeout);

                task.resolve(m.data);
                this.tasks.delete(m.taskId);
            }
        } else {
            void this.onGlobalMessage(m, thread);
        }
    }

    public async executeNoResp(m: ThreadMessageBase<MessageType>): Promise<ThreadData | null> {
        return new Promise(
            async (resolve: (value: ThreadData | PromiseLike<ThreadData> | null) => void) => {
                let selectedThread: Worker = this.threads[this.nextThread];

                if (selectedThread) {
                    resolve(this.executeMessageOnThreadNoResponse(m, selectedThread));
                } else {
                    resolve(null);
                }
            },
        );
    }

    public async execute<T>(m: ThreadMessageBase<MessageType>): Promise<ThreadData | null> {
        return new Promise(
            async (resolve: (value: ThreadData | PromiseLike<ThreadData> | null) => void) => {
                let selectedThread: Worker = this.threads[this.nextThread];

                if (selectedThread) {
                    resolve(this.executeMessageOnThread(m, selectedThread));
                } else {
                    this.warn('No thread available, did something go wrong?');
                    resolve(null);
                }
            },
        );
    }

    public createLinksBetweenAllThreads(): void {
        let threads: Array<Worker> = Array.from(this.threads.values());

        for (let threadId in threads) {
            let selectedThread: Worker = threads[threadId];

            if (selectedThread) {
                for (let threadId2 in threads) {
                    if (threadId2 === threadId) {
                        continue;
                    }

                    let commonMessagePort: MessageChannel = new MessageChannel();

                    const msgRX: LinkThreadMessage<LinkType.RX> = {
                        type: MessageType.LINK_THREAD,
                        data: {
                            type: LinkType.RX,
                            port: commonMessagePort.port2,
                        },
                    };

                    const msgTX: LinkThreadMessage<LinkType.TX> = {
                        type: MessageType.LINK_THREAD,
                        data: {
                            type: LinkType.TX,
                            port: commonMessagePort.port1,
                        },
                    };

                    if (this.subChannels[selectedThread.threadId]) {
                        this.subChannels[selectedThread.threadId].port2.postMessage(msgRX, [
                            commonMessagePort.port2,
                        ]);
                    } else {
                        selectedThread.postMessage(msgRX, [commonMessagePort.port2]);
                    }

                    if (this.subChannels[threads[threadId2].threadId]) {
                        this.subChannels[threads[threadId2].threadId].port2.postMessage(msgTX, [
                            commonMessagePort.port1,
                        ]);
                    } else {
                        threads[threadId2].postMessage(msgTX, [commonMessagePort.port1]);
                    }
                }
            }
        }
    }

    public async createThreads(): Promise<void> {
        return new Promise(
            async (
                resolve: (value: void | PromiseLike<void>) => void,
                reject: (reason?: any) => void,
            ) => {
                let threads = [];

                for (let i = 0; i < this.maxInstance; i++) {
                    threads.push(this.createThread(i));
                }

                Promise.all(threads).then(() => {
                    threads = [];
                    resolve();
                });
            },
        );
    }

    public async createThread(i: number): Promise<void | Worker> {
        return new Promise(
            (resolve: (value: (void | Worker) | PromiseLike<void | Worker>) => void) => {
                setTimeout(() => {
                    if (!this.target) return;

                    let workerOpts: any = { ...{}, ...UtilsConfigurations.WORKER_OPTIONS };

                    workerOpts.name = `Thread ${i} - ${this.target
                        .split('/')
                        .reverse()[0]
                        .replace('.js', '')}`;

                    let thread: Worker = new Worker(this.target, workerOpts);
                    let messageChannel = new MessageChannel();

                    this.subChannels[thread.threadId] = messageChannel;

                    messageChannel.port2.on('error', () => {
                        this.error('Something went wrong with the message port?');
                    });

                    messageChannel.port2.on('message', (m: ThreadMessageBase<MessageType>) => {
                        this.onThreadMessage(thread, m);
                    });

                    thread.on('online', () => {
                        let msg: SetMessagePort = {
                            type: MessageType.SET_MESSAGE_PORT,
                            data: messageChannel.port1,
                        };

                        thread.postMessage(msg, [messageChannel.port1]);
                        resolve(thread);

                        this.threads.push(thread);
                    });

                    thread.on('message', (m: ThreadMessageBase<MessageType>) => {
                        this.onThreadMessage(thread, m);
                    });

                    thread.on('exit', (e: any) => {
                        this.error(
                            `Thread #${i} died. {Target: ${this.target} | ExitCode -> ${e}}`,
                        );

                        fs.appendFileSync(
                            'threader.log',
                            `Thread #${i} died. {Target: ${this.target} | ExitCode -> ${e}}\n`,
                        );

                        // remove thread
                        this.threads.splice(i, 1);

                        setTimeout(() => {
                            this.warn(
                                `!!!!!!!!!!!!!! ------------ Restarting thread #${i}... ------------ !!!!!!!!!!!!!!`,
                            );
                            this.createThread(i);
                        }, 1000);
                    });

                    thread.on('error', (e: any) => {
                        fs.appendFileSync(
                            'threader.log',
                            `Thread #${i} errored. {Target: ${this.target} | Details -> ${e}}\n`,
                        );
                        this.error(
                            `Thread #${i} errored. {Target: ${this.target} | Details: ${e}}`,
                        );
                        this.error(e.stack);
                        resolve();
                    });
                }, i * 200);
            },
        );
    }

    private generateRndTaskId(): string {
        return Math.random().toString(36).substring(2);
    }

    private async executeMessageOnThread(
        message: ThreadMessageBase<MessageType>,
        selectedThread: Worker,
    ): Promise<ThreadData> {
        return new Promise(
            async (resolve: (value: ThreadData | PromiseLike<ThreadData>) => void) => {
                let taskId: string = this.generateRndTaskId();
                let timeout = setTimeout(() => {
                    this.warn(`Thread task ${taskId} timed out.`);

                    resolve({
                        error: true,
                    });
                }, 120000);

                let task: ThreadTaskCallback = {
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
            },
        );
    }

    private async executeMessageOnThreadNoResponse(
        message: ThreadMessageBase<MessageType>,
        selectedThread: Worker,
    ): Promise<void> {
        return new Promise(async (resolve: (value: void | PromiseLike<void>) => void) => {
            if (!message.taskId) {
                message.taskId = this.generateRndTaskId();
            }

            if (this.subChannels[selectedThread.threadId]) {
                this.subChannels[selectedThread.threadId].port2.postMessage(message);
            } else {
                selectedThread.postMessage(message);
            }

            resolve();
        });
    }
}
