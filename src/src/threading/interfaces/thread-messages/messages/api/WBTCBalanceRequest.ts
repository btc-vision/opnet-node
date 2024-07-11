import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { ThreadData } from '../../../ThreadData.js';
import { RPCMessageData } from './RPCMessage.js';
import { Address } from '@btc-vision/bsi-binary';

export type WBTCBalanceResponse = ThreadData & {
    readonly blockHeight: bigint;
    readonly balance: bigint;
    readonly address: Address;
};

export interface WBTCBalanceRequestData {
    readonly address: Address;
    readonly blockHeight: bigint;
}

export interface WBTCBalanceRequest
    extends RPCMessageData<BitcoinRPCThreadMessageType.WBTC_BALANCE_OF> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.WBTC_BALANCE_OF;
    readonly data: WBTCBalanceRequestData;
}
