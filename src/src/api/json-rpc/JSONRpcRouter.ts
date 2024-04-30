import { DefinedRoutes } from '../routes/DefinedRoutes.js';
import { JSONRpcRouteMethods } from './routes/JSONRpcRoute.js';
import { JSONRPCErrorCode } from './types/enums/JSONRPCErrorCode.js';
import { JSONRpcMethods } from './types/enums/JSONRpcMethods.js';
import { JSONRpc2RequestParams } from './types/interfaces/JSONRpc2Request.js';
import { JSONRpc2ResultData } from './types/interfaces/JSONRpc2ResultData.js';
import { JSONRpcResultError } from './types/interfaces/JSONRpcResultError.js';

export class JSONRpcRouter {
    constructor() {}

    public hasMethod(method: string): boolean {
        return JSONRpcRouteMethods.hasOwnProperty(method);
    }

    public async requestResponse<T extends JSONRpcMethods>(
        method: T,
        params: JSONRpc2RequestParams<T>,
    ): Promise<
        | {
              result: JSONRpc2ResultData<T> | null;
          }
        | {
              error: JSONRpcResultError<T>;
          }
        | undefined
    > {
        const routeName = JSONRpcRouteMethods[method];
        if (!routeName) {
            return undefined;
        }

        const route = DefinedRoutes[routeName];
        if (!route) {
            return undefined;
        }

        try {
            const result = (await route.getData(params)) as
                | JSONRpc2ResultData<T>
                | undefined
                | null;

            return {
                result: result ?? null,
            };
        } catch (error) {
            const errorResult: JSONRpcResultError<T> = {
                code: JSONRPCErrorCode.APPLICATION_ERROR,
                message: `Something went wrong executing method ${method}`,
            };

            return {
                error: errorResult,
            };
        }
    }
}
