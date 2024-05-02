import { Address } from '@btc-vision/bsi-binary';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface CallParamsAsObject extends JSONRpcParams<JSONRpcMethods.CALL> {
    readonly from: Address;
    readonly to: Address;
    
    readonly calldata: string;
}

export type CallParamsAsArray = [Address, Address, string];

export type CallParams = CallParamsAsObject | CallParamsAsArray;
