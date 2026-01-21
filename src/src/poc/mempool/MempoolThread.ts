import { Thread } from '../../threading/thread/Thread.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';

import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { Mempool } from './manager/Mempool.js';

export class MempoolThread extends Thread<ThreadTypes.MEMPOOL> {
    public readonly threadType: ThreadTypes.MEMPOOL = ThreadTypes.MEMPOOL;

    private readonly mempool: Mempool = new Mempool();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        await this.mempool.init();

        this.mempool.sendMessageToThread = this.sendMessageToThread.bind(this);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<undefined | ThreadData> {
        switch (type) {
            case ThreadTypes.INDEXER: {
                return await this.handleRequest(m);
            }
            case ThreadTypes.API: {
                return await this.handleRequest(m);
            }
            case ThreadTypes.P2P: {
                return await this.handleRequest(m);
            }
            default: {
                throw new Error(`[onLinkMessage] Unknown message sent by thread of type: ${type}`);
            }
        }
    }

    private async handleRequest(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        return await this.mempool.handleRequest(m);
    }
}

new MempoolThread();
