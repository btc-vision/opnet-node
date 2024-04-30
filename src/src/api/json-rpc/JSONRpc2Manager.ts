import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Config } from '../../config/Config.js';
import { JSONRpcRouter } from './JSONRpcRouter.js';
import { JSONRPCErrorCode, JSONRPCErrorHttpCodes } from './types/enums/JSONRPCErrorCode.js';
import { JSONRpcMethods } from './types/enums/JSONRpcMethods.js';
import {
    JSONRpc2Request,
    JSONRpc2RequestParams,
    JSONRpcId,
} from './types/interfaces/JSONRpc2Request.js';
import {
    JSONRpc2ResponseError,
    JSONRpc2ResponseResult,
} from './types/interfaces/JSONRpc2Result.js';
import { JSONRpcResultError } from './types/interfaces/JSONRpcResultError.js';

export class JSONRpc2Manager extends Logger {
    public static readonly RPC_VERSION: '2.0' = '2.0';

    public readonly logColor: string = '#afeeee';
    private readonly router: JSONRpcRouter = new JSONRpcRouter();

    constructor() {
        super();
    }

    public hasMethod(method: string): boolean {
        return this.router.hasMethod(method);
    }

    public async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const requestData: Partial<JSONRpc2Request<JSONRpcMethods>> | undefined =
                await req.json();

            const hasValidRequest = this.verifyRequest(requestData);
            if (!hasValidRequest || !requestData) {
                this.sendInvalidRequest(res, requestData?.id);
                return;
            }

            if (!this.hasMethod(requestData.method as string)) {
                this.warn(`Method not found: ${requestData.method}`);
                this.sendInvalidMethod(res, requestData.id);
                return;
            }

            const params: JSONRpc2RequestParams<JSONRpcMethods> =
                requestData.params as JSONRpc2RequestParams<JSONRpcMethods>;
            if (Config.DEBUG_LEVEL >= DebugLevel.INFO) {
                this.info(
                    `JSON-RPC requested method: ${requestData.method} - ${JSON.stringify(params)}`,
                );
            }

            const method: JSONRpcMethods = requestData.method as JSONRpcMethods;
            const result = await this.router.requestResponse(method, params);

            if (typeof result === 'undefined') {
                this.sendInternalError(res);
                return;
            }

            if ('error' in result) {
                this.sendErrorResponse(result.error, res, requestData.id);
                return;
            }

            if (!result.result) {
                this.sendInternalError(res);
                return;
            }

            const response: JSONRpc2ResponseResult<JSONRpcMethods> = {
                jsonrpc: JSONRpc2Manager.RPC_VERSION,
                id: requestData.id ?? null,
                result: result.result,
            };

            res.status(200);
            res.json(response);
            res.end();
        } catch (err) {
            const error = err as Error;
            this.error(`Error in JSON-RPC: ${error.stack}`);

            this.sendInternalError(res);
        }
    }

    private verifyRequest(
        requestData: Partial<JSONRpc2Request<JSONRpcMethods>> | undefined,
    ): boolean {
        if (!requestData) {
            return false;
        }

        if (typeof requestData !== 'object') {
            return false;
        }

        const typeofId = typeof requestData.id;
        const hasValidId =
            requestData.id === undefined ||
            requestData.id === null ||
            typeofId === 'number' ||
            typeofId === 'string';

        if (!hasValidId) {
            return false;
        }

        const typeofMethod = typeof requestData.method;
        if (typeofMethod !== 'string' || !requestData.method) {
            return false;
        }

        const typeofParams = typeof requestData.params;
        return !(
            requestData.params === null ||
            !requestData.params ||
            typeofParams !== 'object' ||
            !(Array.isArray(requestData.params) || typeof requestData.params === 'object')
        );
    }

    private sendInternalError(res: Response): void {
        const errorData: JSONRpcResultError<JSONRpcMethods> = {
            code: JSONRPCErrorCode.INTERNAL_ERROR,
            message: 'Internal error',
        };

        res.status(JSONRPCErrorHttpCodes.INTERNAL_ERROR);
        this.sendErrorResponse(errorData, res);
    }

    private sendInvalidMethod(res: Response, id?: JSONRpcId): void {
        const errorData: JSONRpcResultError<JSONRpcMethods> = {
            code: JSONRPCErrorCode.METHOD_NOT_FOUND,
            message: 'Method not found',
        };

        res.status(JSONRPCErrorHttpCodes.METHOD_NOT_FOUND);
        this.sendErrorResponse(errorData, res, id);
    }

    private sendInvalidRequest(res: Response, id?: JSONRpcId): void {
        const errorData: JSONRpcResultError<JSONRpcMethods> = {
            code: JSONRPCErrorCode.INVALID_REQUEST,
            message: 'Invalid Request',
        };

        res.status(JSONRPCErrorHttpCodes.INVALID_REQUEST);
        this.sendErrorResponse(errorData, res, id);
    }

    private sendErrorResponse<T extends JSONRpcMethods>(
        error: JSONRpcResultError<T>,
        res: Response,
        id?: JSONRpcId,
    ): void {
        const response: JSONRpc2ResponseError<T> = {
            jsonrpc: JSONRpc2Manager.RPC_VERSION,
            id: id ?? null,
            error: error,
        };

        res.json(response);
        res.end();
    }
}
