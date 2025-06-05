import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { EventReceiptDataForAPI } from '../../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions';

export interface CallRequestError {
    readonly error: string;
}

export interface AccessListItem {
    [key: string]: string;
}

export interface AccessList {
    [key: string]: AccessListItem;
}

export interface LoadedStorageList {
    [key: string]: string[];
}

export interface ContractEvents {
    [key: string]: EventReceiptDataForAPI[];
}

export interface CallResultData {
    readonly result: string;
    readonly events: ContractEvents;
    revert?: string;
    readonly accessList: AccessList;
    readonly loadedStorage: LoadedStorageList;
    readonly estimatedGas: string;
    readonly estimatedSpecialGas: string;
}

export type CallResult = JSONRpc2ResultData<JSONRpcMethods.CALL> &
    (CallRequestError | CallResultData);
