import { Address } from '@btc-vision/transaction';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface CallParamsAsObject extends JSONRpcParams<JSONRpcMethods.CALL> {
    readonly to: Address;
    readonly calldata: string;

    readonly from?: Address;
    readonly blockNumber?: string;
}

export type CallParamsAsArray = [Address, Address, string?, string?];

export type CallParams = CallParamsAsObject | CallParamsAsArray;
