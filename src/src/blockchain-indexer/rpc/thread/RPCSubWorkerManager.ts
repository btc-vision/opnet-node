import { Logger } from '@btc-vision/bsi-common';
import { ChildProcess, fork, ForkOptions } from 'node:child_process';
import path from 'path';

export class RPCSubWorkerManager extends Logger {
    public readonly workers: ChildProcess[] = [];
    private readonly numConcurrent: number = 10;
    private readonly tasks: Map<
        string,
        {
            resolve: (value: object | undefined) => void;
            timeout: NodeJS.Timeout;
        }
    > = new Map();

    private nextWorkerIndex: number = 0;

    public async startWorkers(): Promise<void> {
        for (let i = 0; i < this.numConcurrent; i++) {
            const worker = this.createWorker();
            this.workers.push(worker);
        }
    }

    public async resolve(data: object): Promise<object | undefined> {
        return new Promise((resolve) => {
            const taskId = this.createTaskId();
            this.tasks.set(taskId, {
                resolve,
                timeout: setTimeout(() => {
                    this.tasks.delete(taskId);
                    resolve(undefined);
                }, 10000),
            });

            this.requestToWorker(JSON.stringify({ taskId, data }));
        });
    }

    private getWorker(): ChildProcess {
        const worker = this.workers[this.nextWorkerIndex];
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
        return worker;
    }

    private requestToWorker(data: string): void {
        const worker = this.getWorker();
        worker.send(data);
    }

    private createTaskId(): string {
        return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    }

    private async onMessage(data: string): Promise<void> {
        console.log('parent', data);
    }

    private createWorker(): ChildProcess {
        const params: ForkOptions = {};
        const currentPath: string = path.join(__dirname, 'RPCSubWorker.js');
        const worker: ChildProcess = fork(currentPath, ['child'], params);

        worker.on('message', this.onMessage.bind(this));

        worker.on('error', (error: Error) => {
            this.error(error);
        });

        worker.on('exit', (code: number) => {
            this.error(`Worker exited with code ${code}`);
        });

        return worker;
    }
}
