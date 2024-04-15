import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { BitcoinRawTransactionParams } from '../../../../../blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { RPCMessageData } from './RPCMessage.js';

export interface GetTransaction extends RPCMessageData<BitcoinRPCThreadMessageType.GET_TX> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.GET_TX;
    readonly data: BitcoinRawTransactionParams;
}
