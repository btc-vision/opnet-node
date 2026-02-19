import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { MempoolTransactionData } from './MempoolTransactionData.js';

/** Payload shape for the `btc_getLatestPendingTransactions` result. */
export interface GetLatestPendingTransactionsResultData {
    /** The list of pending mempool transactions matching the query. */
    readonly transactions: MempoolTransactionData[];
}

/** Result type for the `btc_getLatestPendingTransactions` JSON-RPC method. */
export type GetLatestPendingTransactionsResult =
    JSONRpc2ResultData<JSONRpcMethods.GET_LATEST_PENDING_TRANSACTIONS> &
        GetLatestPendingTransactionsResultData;
