import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface BroadcastTransactionParamsAsObject
    extends JSONRpcParams<JSONRpcMethods.GET_TRANSACTION_BY_HASH> {
    readonly data: string;
    readonly psbt?: boolean;
}

export type BroadcastTransactionParamsAsArray = [string, boolean?];

export type BroadcastTransactionParams =
    | BroadcastTransactionParamsAsObject
    | BroadcastTransactionParamsAsArray;
