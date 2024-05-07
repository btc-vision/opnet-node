import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface TransactionReceiptsParamsAsObject
    extends JSONRpcParams<JSONRpcMethods.GET_TRANSACTION_RECEIPT> {
    readonly hash: string;
}

export type TransactionReceiptsParamsAsArray = [string];

export type TransactionReceiptsParams =
    | TransactionReceiptsParamsAsObject
    | TransactionReceiptsParamsAsArray;
