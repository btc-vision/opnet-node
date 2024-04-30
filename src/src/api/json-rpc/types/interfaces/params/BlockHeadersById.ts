import { JSONRpcMethods } from '../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../JSONRpcParams.js';

export interface BlockHeadersParamsAsObject extends JSONRpcParams<JSONRpcMethods.BLOCK_BY_ID> {
    readonly height: bigint | -1 | string;
}

export type BlockHeadersByIdParamsAsArray = [string | bigint | -1];

export type BlockHeadersById = BlockHeadersParamsAsObject | BlockHeadersByIdParamsAsArray;
