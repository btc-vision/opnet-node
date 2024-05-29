import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { RPCMessageData } from './RPCMessage.js';
import { ThreadData } from '../../../ThreadData.js';

export interface OPNetBroadcastData {
    readonly raw: string;
    readonly psbt: boolean;
}

export type OPNetBroadcastResponse = ThreadData & {
    readonly sentTo: number;
};

export interface BroadcastOPNetRequest
    extends RPCMessageData<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET;
    readonly data: OPNetBroadcastData;
}
