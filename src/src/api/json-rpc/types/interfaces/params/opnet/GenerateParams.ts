import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export enum GenerateTarget {
    WRAP = 0,
}

export interface GenerateParamsAsObject extends JSONRpcParams<JSONRpcMethods.BLOCK_WITNESS> {
    readonly target: GenerateTarget;
    readonly amount: bigint | string;
}

export type GenerateParamsAsArray = [GenerateTarget, bigint | string];

export type GenerateParams = GenerateParamsAsObject | GenerateParamsAsArray;
