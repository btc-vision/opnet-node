import { Logger } from '@btc-vision/bsi-common';
import { MiddlewareHandler } from 'hyper-express';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewarePromise } from 'hyper-express/types/components/middleware/MiddlewareHandler.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Router } from 'hyper-express/types/components/router/Router.js';
import { Routes, RouteType } from '../enums/Routes.js';

export abstract class Route<T extends Routes> extends Logger {
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

    public getRoute(): {
        type: RouteType;
        handler: Router | MiddlewareHandler | MiddlewareHandler[];
    } {
        return {
            type: this.routeType,
            handler: this.onRequestHandler.bind(this) as MiddlewareHandler,
        };
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
