import { CallRequestError } from '../../../../../api/json-rpc/types/interfaces/results/states/CallResult.js';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { EvaluatedResult } from '../../../../../vm/evaluated/EvaluatedResult.js';
import { ThreadData } from '../../../ThreadData.js';
import { RPCMessageData } from './RPCMessage.js';

export interface CallRequestData {
    readonly to: string;
    readonly calldata: string;
    readonly from?: string;
    readonly blockNumber?: bigint;
}

export type CallRequestResponse = ThreadData & (CallRequestError | EvaluatedResult);

export interface CallRequest extends RPCMessageData<BitcoinRPCThreadMessageType.CALL> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.CALL;
    readonly data: CallRequestData;
}
