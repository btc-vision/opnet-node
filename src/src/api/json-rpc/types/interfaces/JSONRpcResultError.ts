import { JSONRPCErrorCode } from '../enums/JSONRPCErrorCode.js';
import { JSONRpcMethods } from '../enums/JSONRpcMethods.js';

export type JSONRpcErrorData<T extends JSONRpcMethods> = object;

export interface JSONRpcResultError<T extends JSONRpcMethods> {
    readonly code: JSONRPCErrorCode;
    readonly message: string;
    readonly data?: JSONRpcErrorData<T>;
}
