import { Logger } from '@btc-vision/bsi-common';
import { MiddlewareHandler } from 'hyper-express';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewarePromise } from 'hyper-express/types/components/middleware/MiddlewareHandler.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Router } from 'hyper-express/types/components/router/Router.js';
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { Routes, RouteType } from '../enums/Routes.js';

export abstract class Route<T extends Routes, U extends unknown> extends Logger {
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

    protected handleDefaultError(res: Response, error: Error): void {
        this.error(`Error in route ${this.routePath}: ${error.stack}`);

        res.status(500);
        res.json({ error: `Something went wrong.` });
    }

    protected abstract onRequest(
        req: Request,
        res: Response,
        next?: MiddlewareNext,
    ): Promise<void | MiddlewarePromise> | void | MiddlewarePromise;

    protected abstract initialize(): void;

    protected abstract getData(): Promise<U> | U;

    private async onRequestHandler(
        req: Request,
        res: Response,
        next?: MiddlewareNext,
    ): Promise<MiddlewarePromise | void> {
        return this.onRequest(req, res, next);
    }
}
