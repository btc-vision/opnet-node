import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface APISubmittedEpochResult {}

export type SubmittedEpochResult = JSONRpc2ResultData<JSONRpcMethods.SUBMIT_EPOCH> &
    APISubmittedEpochResult;
