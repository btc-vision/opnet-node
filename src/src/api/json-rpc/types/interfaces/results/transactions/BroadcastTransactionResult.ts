import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

interface IBroadcastTransactionResult {
    success: boolean;
    result?: string;
    error?: string;
    peers?: number;

    identifier: bigint;
    created?: boolean;
    modifiedTransaction?: string;
    finalizedTransaction?: boolean;
}

export type BroadcastTransactionResult = JSONRpc2ResultData<JSONRpcMethods.BROADCAST_TRANSACTION> &
    IBroadcastTransactionResult;
