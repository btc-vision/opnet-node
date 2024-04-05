import { Config } from '../../../config/Config.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../../threading/thread/Thread.js';
import { BitcoinRPC } from '../BitcoinRPC.js';

export class BitcoinRPCThread extends Thread<ThreadTypes.BITCOIN_RPC> {
    public readonly threadType: ThreadTypes.BITCOIN_RPC = ThreadTypes.BITCOIN_RPC;

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
    }

    private async processAPIMessage(
        message: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | void> {
        switch (message.type) {
            case MessageType.GET_CURRENT_BLOCK: {
                return await this.bitcoinRPC.getBlockHeight();
            }
            default:
                this.error(`Unknown API message received. {Type: ${message.type}}`);
                break;
        }
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | void> {
        switch (type) {
            case ThreadTypes.API: {
                return await this.processAPIMessage(m);
            }
            case ThreadTypes.ZERO_MQ: {
                return await this.processAPIMessage(m);
            }
            case ThreadTypes.BITCOIN_INDEXER: {
                return await this.processAPIMessage(m);
            }
            default:
                this.log(`Unknown thread message received. {Type: ${m.type}}`);
                break;
        }
    }
}

new BitcoinRPCThread();
