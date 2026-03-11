import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface BroadcastTransactionPackageParamsAsObject extends JSONRpcParams<JSONRpcMethods.BROADCAST_TRANSACTION_PACKAGE> {
    readonly txs: string[];
    readonly isPackage?: boolean;
}

export type BroadcastTransactionPackageParamsAsArray = [string[], boolean?];

export type BroadcastTransactionPackageParams =
    | BroadcastTransactionPackageParamsAsObject
    | BroadcastTransactionPackageParamsAsArray;
