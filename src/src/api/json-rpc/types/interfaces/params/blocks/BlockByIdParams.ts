import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface BlockByIdParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_BLOCK_BY_NUMBER> {
    readonly height: bigint | -1 | string;
    readonly sendTransactions?: boolean;
}

export type BlockByIdParamsAsArray = [string | bigint | -1];

export type BlockByIdParams = BlockByIdParamsAsObject | BlockByIdParamsAsArray;
