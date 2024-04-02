import { IHttpRequest, IHttpResponse, INanoexpressApp, MiddlewareRoute } from 'nanoexpress';
import { Logger } from '@btc-vision/motoswapcommon';
import { Routes, RouteType } from '../enums/Routes.js';

export abstract class Route<T extends Routes> extends Logger {
    protected constructor(
        private readonly routePath: T,
        private readonly routeType: RouteType,
    ) {
        super();

        this.initialize();
    }

    protected abstract onRequest(
        req: IHttpRequest,
        res: IHttpResponse,
        next?: (err: Error | null | undefined, done: boolean | undefined) => unknown,
    ): INanoexpressApp | void;

    public getPath(): T {
        return this.routePath;
    }

    public getRoute(): {
        type: RouteType;
        handler: MiddlewareRoute | unknown;
    } {
        return {
            type: this.routeType,
            handler: this.onRequest.bind(this),
        };
    }

    protected abstract initialize(): void;
}
