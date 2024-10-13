import { Logger } from '@btc-vision/bsi-common';
import { ChildProcess, fork, ForkOptions } from 'node:child_process';
import path from 'path';

export class RPCSubWorkerManager extends Logger {
    public readonly workers: ChildProcess[] = [];
    private readonly numConcurrent: number = 2;

    private readonly tasks: Map<
        string,
        {
            resolve: (value: object | undefined) => void;
            timeout: NodeJS.Timeout;
        }
    > = new Map();

    private nextWorkerIndex: number = 0;

    public startWorkers(): void {
        for (let i = 0; i < this.numConcurrent; i++) {
            const worker = this.createWorker();
            this.workers.push(worker);
        }
    }

    public async resolve(data: object, type: string): Promise<object | undefined> {
        return new Promise((resolve) => {
            const taskId = this.createTaskId();
            this.tasks.set(taskId, {
                resolve,
                timeout: setTimeout(() => {
                    this.tasks.delete(taskId);
                    resolve(undefined);
                }, 30000),
            });

            this.requestToWorker(JSON.stringify({ type, taskId, data }));
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

    private onMessage(message: { taskId: string; data: object }): void {
        try {
            const task = this.tasks.get(message.taskId);
            if (task) {
                clearTimeout(task.timeout);
                task.resolve(message.data);
                this.tasks.delete(message.taskId);
            }
        } catch (e) {
            this.error(`Failed to process message. ${e}`);
        }
    }

    private createWorker(): ChildProcess {
        const params: ForkOptions = {};
        const currentPath: string = path.join(__dirname, 'RPCSubWorker.js');
        const worker: ChildProcess = fork(currentPath, ['child'], params);

        worker.on('message', this.onMessage.bind(this));

        worker.on('error', (error: Error) => {
            this.error(error.stack as string);
        });

        worker.on('exit', (code: number) => {
            this.error(`Worker exited with code ${code}`);
        });

        return worker;
    }
}
