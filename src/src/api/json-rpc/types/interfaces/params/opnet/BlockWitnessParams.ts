import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface BlockWitnessAsObject extends JSONRpcParams<JSONRpcMethods.BLOCK_WITNESS> {
    readonly height: bigint | -1 | string;
    readonly trusted?: boolean;
    readonly limit?: number;
    readonly page?: number;
}

export type BlockWitnessAsArray = [bigint | -1 | string, boolean?, number?, number?];

export type BlockWitnessParams = BlockWitnessAsObject | BlockWitnessAsArray;
