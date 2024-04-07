import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { RPCMessageData } from './RPCMessage.js';

export interface GetBlock extends RPCMessageData<BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK;
}
