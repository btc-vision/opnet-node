import { Globals, Logger } from '@btc-vision/motoswapcommon';
import { Worker } from 'worker_threads';
import { ServicesConfigurations } from './api/services/ServicesConfigurations.js';
import { Config } from './config/Config.js';
import { MessageType } from './threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from './threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import {
    LinkThreadRequestData,
    LinkThreadRequestMessage,
} from './threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { ThreadMessageBase } from './threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from './threading/thread/enums/ThreadTypes.js';

Globals.register();

export class Core extends Logger {
    public readonly logColor: string = '#1553c7';

    private readonly masterThreads: Partial<Record<ThreadTypes, Worker>> = {};

    constructor() {
        super();

        void this.start();
    }

    /**
     * Isolate every module manager in a separate thread.
     */
    public async createThreads(): Promise<void> {
        if (Config.DOCS.ENABLED) {
            await this.createThread(0, ThreadTypes.DOCS);
        }

        if (Config.API.ENABLED) {
            await this.createThread(0, ThreadTypes.API);
        }

        await this.createThread(0, ThreadTypes.VM);

        if (Config.INDEXER.ENABLED) {
            await this.createThread(0, ThreadTypes.BITCOIN_INDEXER);
        }
    }

    public async start(): Promise<void> {
        this.log(`Starting up core...`);

        await this.createThreads();
    }

    private onLinkThreadRequest(msg: LinkThreadRequestMessage, threadType: ThreadTypes): void {
        const data: LinkThreadRequestData = msg.data;
        data.mainTargetThreadType = threadType;
        
        const targetThread = this.masterThreads[data.threadType];

        if (!targetThread) {
            this.error(`Target thread ${data.threadType} not found.`);
            return;
        }

        targetThread.postMessage(msg);
    }

    private onLinkThread(msg: LinkThreadMessage<LinkType>): void {
        const targetType = msg.data.mainTargetThreadType || msg.data.targetThreadType;
        const targetThread = this.masterThreads[targetType];

        if (!targetThread) {
            this.error(`Target thread ${msg.data.targetThreadType} not found.`);
            return;
        }

        targetThread.postMessage(msg, [msg.data.port]);
    }

    private onThreadMessage(
        _thread: Worker,
        msg: ThreadMessageBase<MessageType>,
        threadType: ThreadTypes,
    ): void {
        switch (msg.type) {
            case MessageType.LINK_THREAD_REQUEST: {
                this.onLinkThreadRequest(msg as LinkThreadRequestMessage, threadType);
                break;
            }

            case MessageType.LINK_THREAD: {
                this.onLinkThread(msg as LinkThreadMessage<LinkType>);
                break;
            }

            default: {
                this.error(`[CORE] Unknown message type: ${msg.type}`);
                break;
            }
        }
    }

    private createThread(i: number, type: ThreadTypes): Promise<void> {
        return new Promise((resolve) => {
            const settings = ServicesConfigurations[type];
            if (!settings) {
                throw new Error(`No settings found for thread type ${type}.`);
            }

            if (!settings.managerTarget) {
                throw new Error(`No manager target found for thread type ${type}.`);
            }

            let thread = new Worker(settings.managerTarget);

            thread.on('online', () => {
                this.masterThreads[type] = thread;

                this.debug(`Thread #${i} online.`);

                resolve();
            });

            thread.on('exit', (e: any) => {
                this.error(`Thread #${i} died. {ExitCode -> ${e}}`);
            });

            thread.on('error', (e: any) => {
                this.error(`Thread #${i} errored. {Details: ${e.stack}}`);
            });

            thread.on('message', (msg: ThreadMessageBase<MessageType>) => {
                this.onThreadMessage(thread, msg, type);
            });
        });
    }
}
