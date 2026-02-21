import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

/** Object-form parameters for {@link JSONRpcMethods.GET_PENDING_TRANSACTION}. */
export interface GetPendingTransactionParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_PENDING_TRANSACTION> {
    /** The 64-character hex transaction hash. */
    readonly hash: string;
}

/** Array-form parameters: `[hash]`. */
export type GetPendingTransactionParamsAsArray = [string];

/** Accepted parameter shapes for `btc_getPendingTransaction`. */
export type GetPendingTransactionParams =
    | GetPendingTransactionParamsAsObject
    | GetPendingTransactionParamsAsArray;
