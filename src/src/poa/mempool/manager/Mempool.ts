import { Logger } from '@btc-vision/bsi-common';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import {
    BroadcastRequest,
    BroadcastResponse,
} from '../../../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import {
    RPCMessage,
    RPCMessageData,
} from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { OPNetBroadcastData } from '../../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { PSBTTransactionVerifier } from '../psbt/PSBTTransactionVerifier.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Config } from '../../../config/Config.js';
import { cyrb53a, u8 } from '@btc-vision/bsi-binary';

export class Mempool extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly psbtVerifier: PSBTTransactionVerifier = new PSBTTransactionVerifier();

    constructor() {
        super();
    }

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async handleRequest(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        switch (m.type) {
            case MessageType.RPC_METHOD: {
                return await this.onRPCMethod(
                    m.data as RPCMessageData<BitcoinRPCThreadMessageType>,
                );
            }

            default: {
                throw new Error(
                    `[handleRequest] Unknown message sent by thread of type: ${m.type}`,
                );
            }
        }
    }

    public async init(): Promise<void> {
        this.log(`Starting Mempool...`);

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
    }

    private async onRPCMethod(m: RPCMessageData<BitcoinRPCThreadMessageType>): Promise<ThreadData> {
        switch (m.rpcMethod) {
            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET: {
                return await this.onTransactionReceived(m.data as OPNetBroadcastData);
            }

            default: {
                throw new Error(`Unknown message sent by thread of type: ${m.rpcMethod}`);
            }
        }
    }

    private async onTransactionReceived(data: OPNetBroadcastData): Promise<BroadcastResponse> {
        console.log('Mempool.onTransactionReceived', data);

        const raw: Uint8Array = data.raw;
        const psbt: boolean = data.psbt;

        const identifier: bigint = cyrb53a(data.raw as unknown as u8[]);

        let result: BroadcastResponse | null;
        if (!psbt) {
            const rawHex: string = Buffer.from(raw).toString('hex');

            result = (await this.broadcastBitcoinTransaction(rawHex)) || {
                success: false,
                result: 'Could not broadcast transaction to the network.',
                identifier: identifier,
            };
        } else {
            result = this.psbtVerifier.verify(raw)
                ? {
                      success: true,
                      result: 'Valid PSBT transaction.',
                      identifier: identifier,
                  }
                : {
                      success: false,
                      result: 'Invalid PSBT transaction.',
                      identifier: identifier,
                  };
        }

        if (!result.error) {
            return {
                ...result,
                identifier: identifier,
            };
        } else {
            return result;
        }
    }

    private async broadcastBitcoinTransaction(
        data: string,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE,
                    data: data,
                } as BroadcastRequest,
            };

        return (await this.sendMessageToThread(ThreadTypes.BITCOIN_RPC, currentBlockMsg)) as
            | BroadcastResponse
            | undefined;
    }
}
