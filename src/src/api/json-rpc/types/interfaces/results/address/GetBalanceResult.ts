import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface GetBalanceResultForAPI {
    balance: bigint;
}

export type GetBalanceResult = JSONRpc2ResultData<JSONRpcMethods.GET_BALANCE> &
    GetBalanceResultForAPI;
