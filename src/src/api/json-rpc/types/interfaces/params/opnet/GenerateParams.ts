import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';
import { Address } from '@btc-vision/bsi-binary';

export enum GenerateTarget {
    WRAP = 0,
    UNWRAP = 1,
}

export interface GenerateParamsAsObject extends JSONRpcParams<JSONRpcMethods.BLOCK_WITNESS> {
    readonly target: GenerateTarget | string;
    readonly amount: bigint | string;
    readonly receiver?: Address;
}

export type GenerateParamsAsArray = [GenerateTarget | string, bigint | string, Address?];

export type GenerateParams = GenerateParamsAsObject | GenerateParamsAsArray;
