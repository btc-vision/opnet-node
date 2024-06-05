import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { MiddlewareHandler } from 'hyper-express';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewarePromise } from 'hyper-express/types/components/middleware/MiddlewareHandler.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Router } from 'hyper-express/types/components/router/Router.js';
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { Routes, RouteType } from '../enums/Routes.js';
import { JSONRpcMethods } from '../json-rpc/types/enums/JSONRpcMethods.js';
import { JSONRpc2RequestParams } from '../json-rpc/types/interfaces/JSONRpc2Request.js';
import { JSONRpc2ResultData } from '../json-rpc/types/interfaces/JSONRpc2ResultData.js';
import { JSONRpcParams } from '../json-rpc/types/interfaces/JSONRpcParams.js';
import { Config } from '../../config/Config.js';

export abstract class Route<
    T extends Routes,
    R extends JSONRpcMethods,
    U extends unknown | undefined,
> extends Logger {
    protected storage: VMStorage | undefined;

    protected constructor(
        private readonly routePath: T,
        private readonly routeType: RouteType,
    ) {
        super();

        this.initialize();
    }

    public getPath(): T {
        return this.routePath;
    }

    public getRoute(storage: VMStorage): {
        type: RouteType;
        handler: Router | MiddlewareHandler | MiddlewareHandler[];
    } {
        this.storage = storage;

        return {
            type: this.routeType,
            handler: this.onRequestHandler.bind(this) as MiddlewareHandler,
        };
    }

    public abstract getData(params?: JSONRpc2RequestParams<R>): Promise<U> | U;

    public getDataRPC(
        _params?: JSONRpc2RequestParams<R>,
    ): Promise<JSONRpc2ResultData<R> | undefined> | JSONRpc2ResultData<R> | undefined {
        throw new Error('Method not implemented.');
    }

    protected getParams(_req: Request, _res: Response): JSONRpcParams<R> | undefined {
        throw new Error('Method not implemented.');
    }

    protected handleDefaultError(res: Response, error: Error): void {
        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.error(`Error in route ${this.routePath}: ${error.stack}`);
        }

        res.status(500);
        res.json({ error: `Something went wrong.` });
    }

    protected abstract onRequest(
        req: Request,
        res: Response,
        next?: MiddlewareNext,
    ): Promise<void | MiddlewarePromise> | void | MiddlewarePromise;

    protected abstract initialize(): void;

    private async onRequestHandler(
        req: Request,
        res: Response,
        next?: MiddlewareNext,
    ): Promise<MiddlewarePromise | void> {
        return this.onRequest(req, res, next);
    }
}
