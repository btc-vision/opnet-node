import { Config } from '../../../config/Config.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { GetTransaction } from '../../../threading/interfaces/thread-messages/messages/api/GetTransaction.js';
import { RPCMessage } from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { BitcoinRawTransactionParams } from '../../rpc/types/BitcoinRawTransaction.js';
import { BitcoinZeroMQTopic } from '../enums/BitcoinZeroMQTopic.js';
import { ZeroMQ } from '../ZeroMQ.js';

export class NewTxSubscription extends ZeroMQ<BitcoinZeroMQTopic.HASHTX> {
    constructor() {
        const topic = BitcoinZeroMQTopic.HASHTX;
        const zeroMQConfig = Config.ZERO_MQ[topic] || Config.ZERO_MQ[BitcoinZeroMQTopic.EVERYTHING];

        if (!zeroMQConfig) {
            throw new Error(`ZeroMQ config not found for ${topic}`);
        }

        super(zeroMQConfig.ADDRESS, zeroMQConfig.PORT, topic);
    }

    protected async onEvent(topic: string, message: Buffer): Promise<void> {
        if (topic !== BitcoinZeroMQTopic.HASHTX.toLowerCase()) {
            throw new Error(`Invalid topic ${topic}`);
        }

        const txHash = message.toString('hex');
        this.log(`New tx notification received: ${txHash}`);

        const params: BitcoinRawTransactionParams = {
            txId: txHash,
        };

        const testMsg: RPCMessage<BitcoinRPCThreadMessageType.GET_TX> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.GET_TX,
                data: params,
            } as GetTransaction,
        };

        const something = await this.requestRPCMethod(testMsg);
        console.log(JSON.stringify(something, null, 4));
    }
}
