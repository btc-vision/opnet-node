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
import { BlockHeaderAPIBlockDocument } from '../../db/interfaces/IBlockHeaderBlockDocument.js';
import {networks} from "bitcoinjs-lib";
import {NetworkConverter} from "../../config/network/NetworkConverter.js";

export abstract class Route<
    T extends Routes,
    R extends JSONRpcMethods,
    U extends object | string | undefined,
> extends Logger {
    protected readonly network: networks.Network = NetworkConverter.getNetwork();

    protected storage: VMStorage | undefined;

    protected constructor(
        private readonly routePath: T,
        private readonly routeType: RouteType,
    ) {
        super();
    }

    public getPath(): T {
        return this.routePath;
    }

    public getRoute(storage: VMStorage): {
        type: RouteType;
        handler: Router | MiddlewareHandler | MiddlewareHandler[];
    } {
        this.storage = storage;

        this.initialize();

        return {
            type: this.routeType,
            handler: this.onRequestHandler.bind(this) as MiddlewareHandler,
        };
    }

    public onBlockChange(_blockNumber: bigint, _blockHeader: BlockHeaderAPIBlockDocument): void {}

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
        if (Config.DEBUG_LEVEL >= DebugLevel.INFO && Config.DEV_MODE) {
            this.error(`Error in route ${this.routePath}: ${error.stack}`);
        }

        res.status(500);
        res.json({ error: `Something went wrong: ${error.message}` });
    }

    protected abstract onRequest(
        req: Request,
        res: Response,
        next?: MiddlewareNext,
    ): Promise<undefined | MiddlewarePromise> | undefined | MiddlewarePromise;

    protected abstract initialize(): void;

    private async onRequestHandler(
        req: Request,
        res: Response,
        next?: MiddlewareNext,
    ): Promise<MiddlewarePromise | undefined> {
        return this.onRequest(req, res, next);
    }
}
