import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export type BlockByNumberResult = JSONRpc2ResultData<JSONRpcMethods.BLOCK_BY_NUMBER> & string;
