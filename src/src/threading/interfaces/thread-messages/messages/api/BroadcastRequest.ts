import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { ThreadData } from '../../../ThreadData.js';
import { RPCMessageData } from './RPCMessage.js';
import { BroadcastTransactionResult } from '../../../../../api/json-rpc/types/interfaces/results/transactions/BroadcastTransactionResult.js';

export type BroadcastResponse = ThreadData & BroadcastTransactionResult;

export interface BroadcastRequest extends RPCMessageData<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE;
    readonly data: {
        readonly rawTransaction: string;
    };
}
