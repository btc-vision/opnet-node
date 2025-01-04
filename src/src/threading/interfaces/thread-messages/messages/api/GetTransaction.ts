import { BitcoinRawTransactionParams } from '@btc-vision/bitcoin-rpc';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { RPCMessageData } from './RPCMessage.js';

export interface GetTransaction extends RPCMessageData<BitcoinRPCThreadMessageType.GET_TX> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.GET_TX;
    readonly data: BitcoinRawTransactionParams;
}
