import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface IReorgAPIData {
    readonly fromBlock: string;
    readonly toBlock: string;

    readonly timestamp: number;
}

export type ReorgResult = JSONRpc2ResultData<JSONRpcMethods.REORG> & IReorgAPIData[];
