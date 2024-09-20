import { Globals, Logger } from '@btc-vision/bsi-common';
import { Worker } from 'worker_threads';
import { Config } from './config/Config.js';
import { DBManagerInstance } from './db/DBManager.js';
import { IndexManager } from './db/indexes/IndexManager.js';
import { ServicesConfigurations } from './services/ServicesConfigurations.js';
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
import { TrustedAuthority } from './poa/configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from './poa/configurations/manager/AuthorityManager.js';
import { OPNetIdentity } from './poa/identity/OPNetIdentity.js';

Globals.register();

export class Core extends Logger {
    public readonly logColor: string = '#1553c7';

    private readonly masterThreads: Partial<Record<ThreadTypes, Worker>> = {};
    private readonly threads: Worker[] = [];

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();

    constructor() {
        super();

        //this.listenEvents();

        void this.start();
    }

    /**
     * Isolate every module manager in a separate thread.
     */
    public async createThreads(): Promise<void> {
        if (Config.DOCS.ENABLED) {
            await this.createThread(ThreadTypes.DOCS);
        }

        if (Config.API.ENABLED) {
            await this.createThread(ThreadTypes.API);
        }

        if (Config.INDEXER.ENABLED) {
            await this.createThread(ThreadTypes.SYNCHRONISATION);
            await this.createThread(ThreadTypes.INDEXER);
        }

        if (Config.POA.ENABLED) {
            await this.createThread(ThreadTypes.MEMPOOL);
            await this.createThread(ThreadTypes.POA);
        }

        if (Config.SSH.ENABLED) {
            await this.createThread(ThreadTypes.SSH);
        }
    }

    public async start(): Promise<void> {
        this.log(`Starting up core...`);

        const dbOk = await this.setupDB();
        if (!dbOk) {
            process.exit(0);
        }

        this.createIdentity();
        await this.createThreads();
    }

    private createIdentity(): void {
        new OPNetIdentity(Config, this.currentAuthority); // create identity if non-existent. If OPNet is unable to load the current node identity, it will error before starting threads.
    }

    private async setupDB(): Promise<boolean> {
        DBManagerInstance.setup();
        await DBManagerInstance.connect();

        if (!DBManagerInstance.db) {
            this.error('Database connection not established. Check your configurations.');
            return false;
        }

        const indexerManager: IndexManager = new IndexManager(DBManagerInstance);
        await indexerManager.setupDB();

        await DBManagerInstance.close();

        return true;
    }

    private onLinkThreadRequest(msg: LinkThreadRequestMessage, threadType: ThreadTypes): void {
        const data: LinkThreadRequestData = msg.data;
        data.mainTargetThreadType = threadType;

        const targetThread: Worker | undefined = this.masterThreads[data.threadType];
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

    private listenEvents(): void {
        let called = false;
        process.on('SIGINT', () => {
            if (!called) {
                called = true;
                void this.terminateAllActions();
            }
        });

        process.on('SIGQUIT', () => {
            if (!called) {
                called = true;
                void this.terminateAllActions();
            }
        });

        process.on('SIGTERM', () => {
            if (!called) {
                called = true;
                void this.terminateAllActions();
            }
        });
    }

    private requestExitThread(thread: Worker): Promise<void> {
        return new Promise((resolve) => {
            try {
                this.log(`Exiting thread.`);

                thread.on('exit', () => {
                    resolve();
                });

                thread.postMessage({
                    type: MessageType.EXIT_THREAD,
                } as ThreadMessageBase<MessageType>);

                this.log(`Exited thread.`);
            } catch (e) {}
        });
    }

    private async terminateAllActions(): Promise<void> {
        const promises: Promise<void>[] = [];

        for (const thread of this.threads) {
            promises.push(this.requestExitThread(thread));
        }

        await Promise.all(promises);

        this.success('All threads exited successfully.');

        process.exit(0);
    }

    private createThread(type: ThreadTypes): Promise<void> {
        return new Promise((resolve) => {
            const settings = ServicesConfigurations[type];
            if (!settings) {
                throw new Error(`No settings found for thread type ${type}.`);
            }

            if (!settings.managerTarget) {
                throw new Error(`No manager target found for thread type ${type}.`);
            }

            const thread = new Worker(settings.managerTarget);
            thread.on('online', () => {
                this.masterThreads[type] = thread;

                this.debug(`Thread "${type}" online.`);

                resolve();
            });

            thread.on('exit', (e: Error) => {
                this.error(`Thread "${type}" died. {ExitCode -> ${e}}`);
            });

            thread.on('error', (e: Error) => {
                this.error(`Thread "${type}" errored. {Details: ${e.stack}}`);
            });

            thread.on('message', (msg: ThreadMessageBase<MessageType>) => {
                this.onThreadMessage(thread, msg, type);
            });

            this.threads.push(thread);
        });
    }
}
