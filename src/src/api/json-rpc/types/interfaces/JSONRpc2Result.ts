import { JSONRpcMethods } from '../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from './JSONRpc2ResultData.js';
import { JSONRpcResultError } from './JSONRpcResultError.js';

interface JSONRpc2ResultBase<T extends JSONRpcMethods> {
    readonly jsonrpc: '2.0';
    readonly id: number | string | null;
    readonly result?: JSONRpc2ResultData<T>;
    readonly error?: JSONRpcResultError<T>;
}

export interface JSONRpc2ResponseResult<T extends JSONRpcMethods> extends JSONRpc2ResultBase<T> {
    readonly result: JSONRpc2ResultData<T>;
}

export interface JSONRpc2ResponseError<T extends JSONRpcMethods> extends JSONRpc2ResultBase<T> {
    readonly error: JSONRpcResultError<T>;
}

export type JSONRpc2Result<T extends JSONRpcMethods> =
    | JSONRpc2ResponseResult<T>
    | JSONRpc2ResponseError<T>;
