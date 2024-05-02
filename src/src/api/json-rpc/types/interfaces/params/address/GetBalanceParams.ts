import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface GetBalanceParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_BALANCE> {
    readonly address: string;
}

export type GetBalanceParamsAsArray = [string];

export type GetBalanceParams = GetBalanceParamsAsObject | GetBalanceParamsAsArray;
