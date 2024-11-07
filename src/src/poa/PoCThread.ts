import { Config } from '../config/Config.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { PoC } from './PoC.js';

export class PoCThread extends Thread<ThreadTypes.P2P> {
    public readonly threadType: ThreadTypes.P2P = ThreadTypes.P2P;

    private poa: PoC = new PoC(Config);

    constructor() {
        super();

        this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected init(): void {
        this.poa.sendMessageToThread = this.sendMessageToThread.bind(this);

        /**
         * Make sure that other threads are setup before starting PoA.
         */
        setTimeout(() => {
            void this.onThreadLinkSetup();
        }, 5000);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<undefined | ThreadData> {
        switch (type) {
            case ThreadTypes.INDEXER: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.API: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.MEMPOOL: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.SSH: {
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

new PoCThread();
