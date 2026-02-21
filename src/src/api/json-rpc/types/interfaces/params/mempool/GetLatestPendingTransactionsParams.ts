import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

/** Object-form parameters for {@link JSONRpcMethods.GET_LATEST_PENDING_TRANSACTIONS}. */
export interface GetLatestPendingTransactionsParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_LATEST_PENDING_TRANSACTIONS> {
    /** A single address to auto-resolve into all derived wallet address types. */
    readonly address?: string;
    /** Explicit list of addresses to filter mempool transactions by. */
    readonly addresses?: string[];
    /** Maximum number of transactions to return. Clamped to `Config.API.MEMPOOL.MAX_LIMIT`. */
    readonly limit?: number;
}

/** Array-form parameters: `[address?, addresses?, limit?]`. */
export type GetLatestPendingTransactionsParamsAsArray = [string?, string[]?, number?];

/** Accepted parameter shapes for `btc_getLatestPendingTransactions`. */
export type GetLatestPendingTransactionsParams =
    | GetLatestPendingTransactionsParamsAsObject
    | GetLatestPendingTransactionsParamsAsArray;
