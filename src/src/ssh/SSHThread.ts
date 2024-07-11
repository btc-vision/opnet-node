import { Config } from '../config/Config.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { SSH } from './SSH.js';

export class SSHThread extends Thread<ThreadTypes.SSH> {
    public readonly threadType: ThreadTypes.SSH = ThreadTypes.SSH;

    private ssh: SSH = new SSH(Config);

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        this.ssh.sendMessageToThread = this.sendMessageToThread.bind(this);

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
    ): Promise<void | ThreadData> {
        switch (type) {
            case ThreadTypes.BITCOIN_INDEXER: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.API: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.MEMPOOL: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            default: {
                throw new Error(`Unknown message sent by thread of type: ${type}`);
            }
        }
    }

    protected async onThreadLinkSetup(): Promise<void> {
        await this.ssh.init();
    }

    private async handleBitcoinIndexerMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData> {
        return await this.ssh.handleBitcoinIndexerMessage(m);
    }
}

new SSHThread();
