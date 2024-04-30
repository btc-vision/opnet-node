import { JSONRpcMethods } from '../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../JSONRpcParams.js';

export interface BlockByIdParamsAsObject extends JSONRpcParams<JSONRpcMethods.BLOCK_BY_ID> {
    readonly height: bigint | -1 | string;
}

export type BlockByIdParamsAsArray = [string | bigint | -1];

export type BlockByIdParams = BlockByIdParamsAsObject | BlockByIdParamsAsArray;
