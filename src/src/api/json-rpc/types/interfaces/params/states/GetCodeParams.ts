import { Address } from '@btc-vision/transaction';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface GetCodeParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_CODE> {
    readonly address: string;

    readonly onlyBytecode?: boolean;
}

export type GetCodeParamsAsArray = [Address, boolean?];

export type GetCodeParams = GetCodeParamsAsObject | GetCodeParamsAsArray;
