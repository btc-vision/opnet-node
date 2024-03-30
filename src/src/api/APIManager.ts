import { Worker } from 'worker_threads';
import { Logger } from '../logger/Logger.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { Threader } from '../threading/Threader.js';
import { ServicesConfigurations } from './services/ServicesConfigurations.js';

export class APIManager extends Logger {
    public logColor: string = '#bc00fa';

    private apiThreads: Threader = new Threader(ServicesConfigurations.API);

    constructor() {
        super();

        void this.init();
    }

    public async init(): Promise<void> {
        this.registerEventsSubClasses();
        await this.createThreads();
    }

    private async onGlobalMessage(
        msg: ThreadMessageBase<MessageType>,
        _thread: Worker,
    ): Promise<void> {
        switch (msg.type) {
            default: {
                console.log(msg);
                throw new Error('Unknown message type.');
            }
        }
    }

    private registerEventsSubClasses(): void {
        this.apiThreads.onGlobalMessage = this.onGlobalMessage.bind(this);
    }

    private async createThreads(): Promise<void> {
        await this.apiThreads.createThreads();
    }
}

new APIManager();
