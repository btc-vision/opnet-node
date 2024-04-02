import { MessagePort, parentPort } from 'worker_threads';
import { Logger } from '@btc-vision/motoswapcommon';
import { MessageType } from '../enum/MessageType.js';
import { SetMessagePort } from '../interfaces/thread-messages/messages/SetMessagePort.js';
import { ThreadMessageBase } from '../interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../interfaces/ThreadData.js';
import { ThreadTaskCallback } from '../Threader.js';
import { IThread } from './interfaces/IThread.js';

const genRanHex = (size: any) =>
    [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

export abstract class Thread extends Logger implements IThread {
    private messagePort: MessagePort | null = null;
    private tasks: Map<string, ThreadTaskCallback> = new Map<string, ThreadTaskCallback>();

    protected constructor() {
        super();

        void this.init();
    }

    private generateTaskId(): string {
        return genRanHex(8);
    }

    protected async sendMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData | null> {
        return new Promise<ThreadData | null>((resolve, reject) => {
            try {
                let taskId = this.generateTaskId();
                m.taskId = taskId;

                let timeout = setTimeout(() => {
                    this.warn(`Thread task ${taskId} timed out.`);

                    resolve(null);
                }, 2400000);

                let task: ThreadTaskCallback = {
                    timeout: timeout,
                    resolve: resolve,
                };

                this.tasks.set(m.taskId, task);
                if (parentPort) parentPort.postMessage(m);
            } catch (e) {
                reject(e);
            }
        });
    }

    private setMessagePort(msg: SetMessagePort): void {
        this.messagePort = msg.data;

        this.messagePort.on('message', async (msg: ThreadMessageBase<MessageType>) => {
            await this.onThreadMessage(msg);
        });
    }

    private async onThreadMessage(m: ThreadMessageBase<MessageType>): Promise<void> {
        switch (m.type) {
            case MessageType.SET_MESSAGE_PORT:
                this.setMessagePort(m as SetMessagePort);
                break;
            case MessageType.THREAD_RESPONSE:
                await this.onThreadResponse(m);
                break;
            default:
                await this.onMessage(m);
                break;
        }
    }

    private registerEvents(): void {
        if (parentPort) {
            parentPort.on('message', this.onThreadMessage.bind(this));
            parentPort.on('messageerror', this.onThreadMessageError.bind(this));
        }
    }

    private onThreadMessageError(m: any): void {
        this.error(`Thread message error {Details: ${m}}`);
    }

    protected async init(): Promise<void> {
        this.log(`Starting new thread.`);

        this.registerEvents();
    }

    protected abstract onMessage(m: ThreadMessageBase<MessageType>): Promise<void>;

    private async onThreadResponse(m: ThreadMessageBase<MessageType>): Promise<void> {
        if (m !== null && m && m.taskId && !m.toServer) {
            let task: ThreadTaskCallback | undefined = this.tasks.get(m.taskId);
            if (task) {
                clearTimeout(task.timeout);

                task.resolve(m.data);
                this.tasks.delete(m.taskId);
            }
        } else {
            this.error(
                `Thread response doesnt have a task id or sent to server. {TaskId: ${m?.taskId}, ToServer: ${m?.toServer}}`,
            );
        }
    }
}
