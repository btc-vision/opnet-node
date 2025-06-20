import { DefinedRoutes } from '../routes/DefinedRoutes.js';
import { JSONRpcRouteMethods } from './routes/JSONRpcRoute.js';
import { JSONRPCErrorCode } from './types/enums/JSONRPCErrorCode.js';
import { JSONRpcMethods } from './types/enums/JSONRpcMethods.js';
import { JSONRpc2RequestParams } from './types/interfaces/JSONRpc2Request.js';
import { JSONRpc2ResultData } from './types/interfaces/JSONRpc2ResultData.js';
import { JSONRpcResultError } from './types/interfaces/JSONRpcResultError.js';

export type RequestRpcResponse<T extends JSONRpcMethods> = Promise<
    | {
          result: JSONRpc2ResultData<T> | null;
      }
    | {
          error: JSONRpcResultError<T>;
      }
    | undefined
>;

export class JSONRpcRouter {
    public hasMethod(method: string): boolean {
        return Object.prototype.hasOwnProperty.call(JSONRpcRouteMethods, method);
    }

    public async requestResponse<T extends JSONRpcMethods>(
        method: T,
        params: JSONRpc2RequestParams<T>,
    ): RequestRpcResponse<T> {
        const routeName = JSONRpcRouteMethods[method];
        if (!routeName) {
            return undefined;
        }

        const route = DefinedRoutes[routeName];
        if (!route) {
            return undefined;
        }

        try {
            const result = await route.getDataRPC(params);

            return {
                result: result ?? null,
            };
        } catch (err) {
            const error = err as Error;
            const errorResult: JSONRpcResultError<T> = {
                code: JSONRPCErrorCode.APPLICATION_ERROR,
                message: typeof err === 'string' ? err : error.message,
            };

            return {
                error: errorResult,
            };
        }
    }
}
