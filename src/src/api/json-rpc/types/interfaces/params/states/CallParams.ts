import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface CallParamsAsObject extends JSONRpcParams<JSONRpcMethods.CALL> {
    readonly to: string;
    readonly calldata: string;

    readonly from?: string;
    readonly blockNumber?: string;
}

export type CallParamsAsArray = [string, string, string?, string?];

export type CallParams = CallParamsAsObject | CallParamsAsArray;
