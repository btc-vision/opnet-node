import { Address } from '@btc-vision/bsi-binary';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface GetStorageAtParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_STORAGE_AT> {
    readonly address: Address;
    readonly pointer: string;

    readonly sendProofs?: boolean;
    readonly height?: string;
}

export type GetStorageAtParamsAsArray = [Address, string, boolean?, string?];

export type GetStorageAtParams = GetStorageAtParamsAsObject | GetStorageAtParamsAsArray;
