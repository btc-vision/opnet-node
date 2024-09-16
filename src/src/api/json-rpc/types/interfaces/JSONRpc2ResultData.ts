import { JSONRpcMethods } from '../enums/JSONRpcMethods.js';

export type JSONRpc2ResultData<T extends JSONRpcMethods> = object | string;
