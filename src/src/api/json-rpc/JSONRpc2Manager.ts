import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
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
import { Config } from '../../config/Config.js';

//import json from 'big-json';

export class JSONRpc2Manager extends Logger {
    public static readonly RPC_VERSION = '2.0' as const;

    public readonly logColor: string = '#afeeee';
    private readonly router: JSONRpcRouter = new JSONRpcRouter();

    private pendingRequests: number = 0;

    public constructor() {
        super();
    }

    public hasMethod(method: string): boolean {
        return this.router.hasMethod(method);
    }

    public incrementPendingRequests(res: Response, requestSize: number): boolean {
        // Check if the number of pending requests is too high
        if (this.pendingRequests + requestSize > Config.API.MAXIMUM_PENDING_REQUESTS_PER_THREADS) {
            this.sendError(
                'Too many pending requests',
                JSONRPCErrorHttpCodes.SERVER_ERROR,
                JSONRPCErrorCode.SERVER_ERROR,
                res,
            );

            return false;
        }

        this.pendingRequests += requestSize;

        return true;
    }

    public async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        let requestSize: number = 0;
        try {
            const requestData: Partial<JSONRpc2Request<JSONRpcMethods>> | undefined =
                await req.json();

            let response:
                | JSONRpc2ResponseResult<JSONRpcMethods>
                | JSONRpc2ResponseResult<JSONRpcMethods>[];

            // Batch request
            if (Array.isArray(requestData)) {
                const length = requestData.length;

                if (length > Config.API.MAXIMUM_REQUESTS_PER_BATCH) {
                    // throw error if the batch request is too large
                    this.sendError(
                        'Too many requests in batch.',
                        JSONRPCErrorHttpCodes.INVALID_REQUEST,
                        JSONRPCErrorCode.INVALID_REQUEST,
                        res,
                    );
                    return;
                }

                requestSize += length + 1;
                if (!this.incrementPendingRequests(res, requestSize)) {
                    return; // already sent error
                }

                response = await this.requestInBatchOf(
                    requestData,
                    res,
                    Config.API.BATCH_PROCESSING_SIZE,
                );
            } else {
                requestSize += 1;
                if (!this.incrementPendingRequests(res, requestSize)) {
                    return; // already sent error
                }

                const resp = await this.processSingleRequest(res, requestData);
                if (!resp) {
                    throw new Error('Invalid request');
                }

                response = resp;
            }

            //const stream = json.createStringifyStream({
            //    body: response,
            //});

            res.status(200);
            res.header('Content-Type', 'application/json');

            //if (stream instanceof Readable) {
            //    await res.stream(stream);
            //}

            res.json(response);
            res.end();
        } catch (err) {
            if (Config.DEV.DEBUG_API_ERRORS) {
                this.error(`API Error: ${(err as Error).message}`);
            }

            // Ensure this never throws
            try {
                const error = err as Error;
                const message = error.message;

                if (!message.includes('a batch request failed')) {
                    if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                        this.error(`API Error: ${Config.DEV_MODE ? error.stack : error.message}`);
                    }
                }

                this.sendInternalError(res);
            } catch (e) {}
        }

        this.pendingRequests -= requestSize;
    }

    private sendError(
        msg: string,
        type: JSONRPCErrorHttpCodes,
        code: JSONRPCErrorCode,
        res: Response,
    ): void {
        const errorData: JSONRpcResultError<JSONRpcMethods> = {
            code: code,
            message: msg,
        };

        res.status(type);
        this.sendErrorResponse(errorData, res);
    }

    private async requestInBatchOf(
        request: JSONRpc2Request<JSONRpcMethods>[],
        res: Response,
        batchSize: number,
    ): Promise<JSONRpc2ResponseResult<JSONRpcMethods>[]> {
        const length = request.length;

        let i = 0;

        const responses: JSONRpc2ResponseResult<JSONRpcMethods>[] = [];
        while (i < length) {
            const batch = request.slice(i, i + batchSize);
            const pendingPromise: Promise<JSONRpc2ResponseResult<JSONRpcMethods> | undefined>[] =
                [];

            for (const req of batch) {
                pendingPromise.push(this.processSingleRequest(res, req));
            }

            const resp = await Promise.all(pendingPromise);

            // We must check if the response is an array of undefined values
            // If so, we must send an internal error
            if (resp.every((value) => value === undefined)) {
                throw new Error('Something went wrong, a batch request failed');
            }

            i += batchSize;
            responses.push(...(resp as JSONRpc2ResponseResult<JSONRpcMethods>[]));
        }

        return responses;
    }

    private async processSingleRequest(
        res: Response,
        requestData: Partial<JSONRpc2Request<JSONRpcMethods>> | undefined,
    ): Promise<JSONRpc2ResponseResult<JSONRpcMethods> | undefined> {
        const hasValidRequest = this.verifyRequest(requestData);
        if (!hasValidRequest || !requestData) {
            this.sendInvalidRequest(res, requestData?.id);
            return;
        }

        if (requestData.method?.startsWith('eth_')) {
            requestData.method = requestData.method.replace('eth_', 'btc_') as JSONRpcMethods;
        }

        if (!this.hasMethod(requestData.method as string)) {
            this.warn(`Method not found: ${requestData.method}`);
            this.sendInvalidMethod(res, requestData.id);
            return;
        }

        const params: JSONRpc2RequestParams<JSONRpcMethods> =
            requestData.params as JSONRpc2RequestParams<JSONRpcMethods>;

        /*if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debugBright(
                `JSON-RPC requested method: ${requestData.method} - ${JSON.stringify(params)}`,
            );
        }*/

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

        return {
            jsonrpc: JSONRpc2Manager.RPC_VERSION,
            id: requestData.id ?? null,
            result: result.result,
        };
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
        if (res.closed) return;

        const errorData: JSONRpcResultError<JSONRpcMethods> = {
            code: JSONRPCErrorCode.INTERNAL_ERROR,
            message: 'Internal error',
        };

        res.status(JSONRPCErrorHttpCodes.INTERNAL_ERROR);
        this.sendErrorResponse(errorData, res);
    }

    private sendInvalidMethod(res: Response, id?: JSONRpcId): void {
        if (res.closed) return;

        const errorData: JSONRpcResultError<JSONRpcMethods> = {
            code: JSONRPCErrorCode.METHOD_NOT_FOUND,
            message: 'Method not found',
        };

        res.status(JSONRPCErrorHttpCodes.METHOD_NOT_FOUND);
        this.sendErrorResponse(errorData, res, id);
    }

    private sendInvalidRequest(res: Response, id?: JSONRpcId): void {
        if (res.closed) return;

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
        if (res.closed) return;

        const response: JSONRpc2ResponseError<T> = {
            jsonrpc: JSONRpc2Manager.RPC_VERSION,
            id: id ?? null,
            error: error,
        };

        res.json(response);
        res.end();
    }
}
