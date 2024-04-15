import { Logger } from '@btc-vision/bsi-common';
import { IHttpRequest, IHttpResponse, INanoexpressApp, MiddlewareRoute } from 'nanoexpress';
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
        handler: MiddlewareRoute | unknown;
    } {
        return {
            type: this.routeType,
            handler: this.onRequestHandler.bind(this), //this.onRequest.bind(this),
        };
    }

    private async onRequestHandler(
        req: IHttpRequest,
        res: IHttpResponse,
        next?: (err: Error | null | undefined, done: boolean | undefined) => unknown,
    ): Promise<INanoexpressApp | void> {
        return this.onRequest(req, res, next);
    }

    protected abstract onRequest(
        req: IHttpRequest,
        res: IHttpResponse,
        next?: (err: Error | null | undefined, done: boolean | undefined) => unknown,
    ): Promise<void | INanoexpressApp> | void | INanoexpressApp;

    protected abstract initialize(): void;
}
