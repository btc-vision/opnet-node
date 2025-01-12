import {
    AccessList,
    CallRequestError,
} from '../../../../../api/json-rpc/types/interfaces/results/states/CallResult.js';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { ThreadData } from '../../../ThreadData.js';
import { RPCMessageData } from './RPCMessage.js';
import { SafeEvaluatedResult } from '../../../../../vm/evaluated/EvaluatedResult.js';
import { SimulatedTransaction } from '../../../../../api/json-rpc/types/interfaces/params/states/CallParams.js';

export interface CallRequestData {
    readonly to: string;
    readonly calldata: string;
    readonly from?: string;
    readonly blockNumber?: bigint;
    readonly transaction?: SimulatedTransaction;
    readonly accessList?: AccessList;
}

export type CallRequestResponse = ThreadData & (CallRequestError | SafeEvaluatedResult);

export interface CallRequest extends RPCMessageData<BitcoinRPCThreadMessageType.CALL> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.CALL;
    readonly data: CallRequestData;
}
