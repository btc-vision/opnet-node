import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { RPCMessageData } from './RPCMessage.js';
import { ThreadData } from '../../../ThreadData.js';

export interface OPNetBroadcastData {
    readonly raw: Uint8Array;
    readonly psbt: boolean;
    readonly id: string;
}

export type OPNetBroadcastResponse = ThreadData & {
    readonly peers: number;
};

export interface BroadcastOPNetRequest extends RPCMessageData<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET;
    readonly data: OPNetBroadcastData;
}
