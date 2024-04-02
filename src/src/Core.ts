import { Globals, Logger } from '@btc-vision/motoswapcommon';
import { Worker } from 'worker_threads';
import { Config } from './config/Config.js';

Globals.register();

export class Core extends Logger {
    public readonly logColor: string = '#1553c7';

    constructor() {
        super();

        this.start();
    }

    /**
     * Isolate every module manager in a separate thread.
     */
    public createThreads(): void {
        if (Config.DOCS.ENABLED) {
            this.createThread(0, './src/docs/Docs.js');
        }

        if (Config.API.ENABLED) {
            this.createThread(0, './src/api/ApiManager.js');
        }

        if (Config.INDEXER.ENABLED) {
            this.createThread(0, './src/blockchain-indexer/BlockchainIndexerManager.js');
        }

        this.createThread(0, './src/vm/VMThread.js');
    }

    public start(): void {
        this.log(`Starting up core...`);

        this.createThreads();
    }

    private createThread(i: number, target: string): void {
        let thread = new Worker(target);

        thread.on('online', () => {
            this.debug(`Thread #${i} online.`);
        });

        thread.on('exit', (e: any) => {
            this.error(`Thread #${i} died. {ExitCode -> ${e}}`);
        });

        thread.on('error', (e: any) => {
            this.error(`Thread #${i} errored. {Details: ${e.stack}}`);
        });
    }
}
