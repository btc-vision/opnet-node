import { Config } from '../config/Config.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { PoA } from './PoA.js';

export class PoAThread extends Thread<ThreadTypes.PoA> {
    public readonly threadType: ThreadTypes.PoA = ThreadTypes.PoA;

    private poa: PoA = new PoA(Config);

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        this.poa.sendMessageToThread = this.sendMessageToThread.bind(this);

        /**
         * Make sure that other threads are setup before starting PoA.
         */
        setTimeout(() => {
            void this.onThreadLinkSetup();
        }, 10000);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void | ThreadData> {
        switch (type) {
            case ThreadTypes.BITCOIN_INDEXER: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            default: {
                throw new Error(`Unknown message sent by thread of type: ${type}`);
            }
        }
    }

    protected async onThreadLinkSetup(): Promise<void> {
        await this.poa.init();
    }

    private async handleBitcoinIndexerMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData> {
        return await this.poa.handleBitcoinIndexerMessage(m);
    }
}

new PoAThread();
