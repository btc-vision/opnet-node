import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

interface IBroadcastTransactionResult {
    success: boolean;
    result?: string;
    error?: string;
    peers?: number;

    identifier: bigint;
    modifiedTransaction?: string;
}

export type BroadcastTransactionResult = JSONRpc2ResultData<JSONRpcMethods.BROADCAST_TRANSACTION> &
    IBroadcastTransactionResult;
