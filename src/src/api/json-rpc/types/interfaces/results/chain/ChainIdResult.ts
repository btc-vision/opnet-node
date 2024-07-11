import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export type ChainIdResult = JSONRpc2ResultData<JSONRpcMethods.CHAIN_ID> & string;
