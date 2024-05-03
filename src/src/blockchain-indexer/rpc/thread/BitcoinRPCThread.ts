import { BitcoinRawTransactionParams, BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Config } from '../../../config/Config.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import {
    CallRequestData,
    CallRequestResponse,
} from '../../../threading/interfaces/thread-messages/messages/api/CallRequest.js';
import { RPCMessage } from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../../threading/thread/Thread.js';
import { VMManager } from '../../../vm/VMManager.js';
import { BitcoinRPCThreadMessageType } from './messages/BitcoinRPCThreadMessage.js';

export class BitcoinRPCThread extends Thread<ThreadTypes.BITCOIN_RPC> {
    public readonly threadType: ThreadTypes.BITCOIN_RPC = ThreadTypes.BITCOIN_RPC;

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly vmManager: VMManager = new VMManager(Config, true);

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.vmManager.init();
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | void> {
        if (m.type !== MessageType.RPC_METHOD) throw new Error('Invalid message type');

        switch (type) {
            case ThreadTypes.API: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.ZERO_MQ: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.BITCOIN_INDEXER: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            default:
                this.log(`Unknown thread message received. {Type: ${m.type}}`);
                break;
        }
    }

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | void> {
        this.info(`Call request received. {To: ${data.to.toString()}, Calldata: ${data.calldata}}`);

        if (!this.vmManager.initiated) {
            return {
                error: 'Not ready to process call requests',
            };
        }

        let result: CallRequestResponse | void;
        try {
            result = await this.vmManager.execute(data.to, data.calldata);
        } catch (e) {
            const error = e as Error;

            result = {
                error: error.message || 'Unknown error',
            };
        }

        return result;
    }

    private async processAPIMessage(
        message: RPCMessage<BitcoinRPCThreadMessageType>,
    ): Promise<ThreadData | void> {
        const rpcMethod = message.data.rpcMethod;

        switch (rpcMethod) {
            case BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK: {
                return await this.bitcoinRPC.getBlockHeight();
            }
            case BitcoinRPCThreadMessageType.GET_TX: {
                return await this.bitcoinRPC.getRawTransaction(
                    message.data.data as BitcoinRawTransactionParams,
                );
            }

            case BitcoinRPCThreadMessageType.CALL: {
                return await this.onCallRequest(message.data.data as CallRequestData);
            }

            default:
                this.error(`Unknown API message received. {Type: ${message.type}}`);
                break;
        }
    }
}

new BitcoinRPCThread();
