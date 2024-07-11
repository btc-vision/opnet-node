import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface GetStorageAtResultAPI {
    readonly pointer: string;
    readonly value: string;

    readonly height: string;
    readonly proofs?: string[];
}

export type GetStorageAtResult = JSONRpc2ResultData<JSONRpcMethods.GET_STORAGE_AT> &
    GetStorageAtResultAPI;
