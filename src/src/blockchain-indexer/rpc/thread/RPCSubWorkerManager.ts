import { Logger } from '@btc-vision/bsi-common';
import { ChildProcess, fork, ForkOptions } from 'node:child_process';
import path from 'path';

export class RPCSubWorkerManager extends Logger {
    public readonly workers: ChildProcess[] = [];
    private readonly numConcurrent: number = 10;

    public async startWorkers(): Promise<void> {
        for (let i = 0; i < this.numConcurrent; i++) {
            const worker = this.createWorker();
            this.workers.push(worker);
        }
    }

    private createWorker(): ChildProcess {
        const params: ForkOptions = {};
        const currentPath: string = path.join(__dirname, 'RPCSubWorker.ts');
        console.log('currentPath', currentPath);

        const worker: ChildProcess = fork('./', params);

        worker.on('message', (message: string) => {
            this.log(message);
        });

        worker.on('error', (error: Error) => {
            this.error(error);
        });

        worker.on('exit', (code: number) => {
            this.error(`Worker exited with code ${code}`);
        });

        return worker;
    }
}
