import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { RPCMessageData } from './RPCMessage.js';
import { ThreadData } from '../../../ThreadData.js';

export interface BitcoinFees {
    readonly feeRate: bigint;
}

export type FeeMessageResponse = ThreadData & {
    readonly bitcoinFees: BitcoinFees;
};

export interface FeeRequestMessageData
    extends RPCMessageData<BitcoinRPCThreadMessageType.GET_MEMPOOL_FEES> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.GET_MEMPOOL_FEES;
}
