import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface GetBalanceParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_BALANCE> {
    readonly address: string;
    readonly filterOrdinals?: boolean;
}

export type GetBalanceParamsAsArray = [string, boolean?];

export type GetBalanceParams = GetBalanceParamsAsObject | GetBalanceParamsAsArray;
