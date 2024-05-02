import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export type CallResult = JSONRpc2ResultData<JSONRpcMethods.CALL> & {}; // TODO: Specify return type
