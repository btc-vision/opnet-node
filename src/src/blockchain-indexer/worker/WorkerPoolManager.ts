import { Transferable, Worker } from 'node:worker_threads';
import os from 'node:os';
import { TransactionSafeThread } from '../../db/interfaces/ITransactionDocument.js';
import { MsgToMain, ParseTask } from './interfaces.js';
import { Logger } from '@btc-vision/bsi-common';

type Callbacks = {
    resolve: (v: TransactionSafeThread) => void;
    reject: (e: unknown) => void;
};

export class WorkerPoolManager extends Logger {
    public readonly logColor: string = '#5500ff';

    private readonly workers: Worker[] = [];
    private readonly inflight: Map<number, Callbacks>[] = [];

    private seq = 0 >>> 0;
    private cursor = 0;

    private readonly workerPath: URL = new URL('./TransactionProcessor.js', import.meta.url);

    constructor(poolSize = os.cpus().length) {
        super();

        for (let i = 0; i < poolSize; ++i) {
            this.spawnWorker(i);
        }
    }

    public parse(task: ParseTask): Promise<TransactionSafeThread> {
        return new Promise<TransactionSafeThread>((resolve, reject) => {
            try {
                const w = this.nextWorker();
                const list = this.inflight[this.workers.indexOf(w)];
                const id = this.nextId(list);

                list.set(id, { resolve, reject });

                const transferable: readonly Transferable[] = [];
                w.postMessage({ ...task, id }, transferable);
            } catch (e) {
                this.error(`Failed to post message to worker: ${e}`);

                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                reject(e);
            }
        });
    }

    public async close(): Promise<void> {
        await Promise.all(
            this.workers.map(async (w, idx) => {
                const map = this.inflight[idx];
                map.forEach((cb) => cb.reject(new Error('pool closed')));
                map.clear();
                await w.terminate();
            }),
        );
    }

    private nextWorker(): Worker {
        const w = this.workers[this.cursor];
        this.cursor = (this.cursor + 1) % this.workers.length;
        return w;
    }

    private nextId(map: Map<number, unknown>): number {
        do {
            this.seq = (this.seq + 1) >>> 0;
        } while (map.has(this.seq));
        return this.seq;
    }

    private spawnWorker(index: number): void {
        const w = new Worker(this.workerPath);
        const list = new Map<number, Callbacks>();

        this.workers[index] = w;
        this.inflight[index] = list;

        w.on('message', (data: MsgToMain) => {
            const id = data.id;
            const cb = list.get(id);
            if (!cb) {
                this.error(`Worker ${index} sent result for unknown id ${id}`);

                return;
            }

            list.delete(id);

            const error = 'error' in data ? new Error(data.error) : null;
            if (error) {
                cb.reject(error);
            } else if ('result' in data) {
                cb.resolve(data.result);
            } else {
                this.error(`Worker ${index} sent invalid message: ${JSON.stringify(data)}`);

                cb.reject(new Error('Invalid message from worker'));
            }
        });

        w.on('error', (err: unknown) => {
            this.error(`Worker ${index} error: ${(err as Error).message}`);

            list.forEach((cb) => cb.reject(err));
            list.clear();
        });

        w.on('exit', (code) => {
            if (code !== 0) {
                const err = new Error(`worker exited with code ${code}`);
                list.forEach((cb) => cb.reject(err));
                list.clear();
            }
        });
    }
}
