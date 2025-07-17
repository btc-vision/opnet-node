import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface APIEpochTemplateResult {}

export type EpochTemplateResult = JSONRpc2ResultData<JSONRpcMethods.GET_EPOCH_TEMPLATE> &
    APIEpochTemplateResult;
