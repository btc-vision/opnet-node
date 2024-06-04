import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface IGenerateResult {
    readonly generatedTransaction: string;
}

export type GeneratedResult = JSONRpc2ResultData<JSONRpcMethods.GENERATE> & IGenerateResult;
