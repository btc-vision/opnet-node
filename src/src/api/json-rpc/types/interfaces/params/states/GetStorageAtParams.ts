import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface GetStorageAtParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_STORAGE_AT> {
    readonly address: string;
    readonly pointer: string;

    readonly sendProofs?: boolean;
    readonly height?: string;
}

export type GetStorageAtParamsAsArray = [string, string, boolean?, string?];

export type GetStorageAtParams = GetStorageAtParamsAsObject | GetStorageAtParamsAsArray;
