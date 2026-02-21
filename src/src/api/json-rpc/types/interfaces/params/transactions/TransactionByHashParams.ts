import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface TransactionByHashParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_TRANSACTION_BY_HASH> {
    readonly hash: string;
}

export type TransactionByHashParamsAsArray = [string];

export type TransactionByHashParams =
    | TransactionByHashParamsAsObject
    | TransactionByHashParamsAsArray;
