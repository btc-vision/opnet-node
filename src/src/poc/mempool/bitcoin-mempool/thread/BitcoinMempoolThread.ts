import { Thread } from '../../../../threading/thread/Thread.js';
import { ThreadTypes } from '../../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../../threading/interfaces/thread-messages/ThreadMessageBase.js';

import { ThreadData } from '../../../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../../../threading/enum/MessageType.js';
import { MempoolManager } from '../MempoolManager.js';
import { Config } from '../../../../config/Config.js';

class BitcoinMempoolThread extends Thread<ThreadTypes.MEMPOOL_MANAGER> {
    public readonly threadType: ThreadTypes.MEMPOOL_MANAGER = ThreadTypes.MEMPOOL_MANAGER;

    private readonly mempoolManager: MempoolManager = new MempoolManager();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        if (!Config.INDEXER.READONLY_MODE) {
            await this.mempoolManager.init();
        }

        this.mempoolManager.sendMessageToThread = this.sendMessageToThread.bind(this);
    }

    protected onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): undefined | ThreadData {
        switch (type) {
            case ThreadTypes.MEMPOOL: {
                return this.handleRequest(m);
            }
            default: {
                throw new Error(`[onLinkMessage] Unknown message sent by thread of type: ${type}`);
            }
        }
    }

    private handleRequest(m: ThreadMessageBase<MessageType>): ThreadData {
        return this.mempoolManager.handleRequest(m);
    }
}

new BitcoinMempoolThread();
