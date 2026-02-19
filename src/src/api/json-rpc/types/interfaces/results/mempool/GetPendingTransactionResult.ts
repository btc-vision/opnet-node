import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { MempoolTransactionData } from './MempoolTransactionData.js';

/** Result type for the `btc_getPendingTransaction` JSON-RPC method. */
export type GetPendingTransactionResult =
    JSONRpc2ResultData<JSONRpcMethods.GET_PENDING_TRANSACTION> & MempoolTransactionData;
