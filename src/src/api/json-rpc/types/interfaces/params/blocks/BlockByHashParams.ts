import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface BlockByHashParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_BLOCK_BY_HASH> {
    readonly blockHash: string;
    readonly sendTransactions?: boolean;
}

export type BlockByHashParamsAsArray = [string, boolean?];

export type BlockByHashParams = BlockByHashParamsAsObject | BlockByHashParamsAsArray;
