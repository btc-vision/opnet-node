import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface BlockByChecksumAsObject
    extends JSONRpcParams<JSONRpcMethods.GET_BLOCK_BY_CHECKSUM> {
    readonly blockHash: string;
    readonly sendTransactions?: boolean;
}

export type BlockByChecksumAsArray = [string, boolean?];

export type BlockByChecksumParams = BlockByChecksumAsObject | BlockByChecksumAsArray;
