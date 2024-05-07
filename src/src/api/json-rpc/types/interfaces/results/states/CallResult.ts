import { NetEvent } from '@btc-vision/bsi-binary';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface CallRequestError {
    readonly error: string;
}

export interface AccessListItem {
    [key: string]: string;
}

export interface AccessList {
    [key: string]: AccessListItem;
}

export interface CallResultData {
    readonly result: string;
    readonly events: NetEvent[];
    readonly accessList: AccessList;
}

export type CallResult = JSONRpc2ResultData<JSONRpcMethods.CALL> &
    (CallRequestError | CallResultData);
