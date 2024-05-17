import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface ReorgAsObject extends JSONRpcParams<JSONRpcMethods.REORG> {
    readonly fromBlock?: string;
    readonly toBlock?: string;
}

export type ReorgAsArray = [string?, string?];

export type ReorgParams = ReorgAsObject | ReorgAsArray;
