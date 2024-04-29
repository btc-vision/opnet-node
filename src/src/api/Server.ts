import { Globals, Logger } from '@btc-vision/bsi-common';
import HyperExpress, { MiddlewareHandler } from 'hyper-express';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Router } from 'hyper-express/types/components/router/Router.js';
import { Config } from '../config/Config.js';
import { VMMongoStorage } from '../vm/storage/databases/VMMongoStorage.js';
import { VMStorage } from '../vm/storage/VMStorage.js';

import { DefinedRoutes } from './routes/DefinedRoutes.js';

Globals.register();

export type HyperExpressRoute = keyof Pick<
    Router,
    | 'get'
    | 'post'
    | 'put'
    | 'use'
    | 'delete'
    | 'patch'
    | 'options'
    | 'head'
    | 'trace'
    | 'all'
    | 'connect'
    | 'upgrade'
>;

export type RouterHandler<T extends HyperExpressRoute> = Router[T];

export class Server extends Logger {
    public logColor: string = '#00fa9a';

    private apiPrefix: string = '/api/v1';

    private serverPort: number = 0;
    private app: HyperExpress.Server = new HyperExpress.Server();

    private readonly storage: VMStorage = new VMMongoStorage(Config);

    constructor() {
        super();
    }

    public async createServer(): Promise<void> {
        await this.storage.init();

        // ERROR HANDLING
        this.app.set_error_handler(this.globalErrorHandler.bind(this));

        //this.app.use(cors());
        this.app.use(this.handleAny.bind(this));

        // GET
        this.loadRoutes();

        // WS
        // @ts-ignore
        this.app.ws(`${this.apiPrefix}/live`, this.onNewWebsocketConnection.bind(this), {
            maxPayloadLength: 16 * 1024 * 1024,
            idleTimeout: 4 * 3,
        });

        //LISTEN
        await this.app.listen(this.serverPort);
        this.log(`Server listening on port ${this.serverPort}.`);
    }

    public async init(port: number | undefined): Promise<void> {
        if (port) {
            this.serverPort = port;
        }

        await this.createServer();
    }

    private globalErrorHandler(_request: Request, response: Response, _error: Error): void {
        response.status(500);

        this.error(`API Error: ${_error.stack}`);

        response.json({
            error: 'Something went wrong.',
        });
    }

    private loadRoutes(): void {
        for (const route of Object.values(DefinedRoutes)) {
            const routeData = route.getRoute(this.storage);
            const path = `${this.apiPrefix}/${route.getPath()}`;

            this.log(`Loading route: ${path} (${routeData.type})`);

            const typeRoute = routeData.type as HyperExpressRoute;
            const handler = routeData.handler as RouterHandler<typeof typeRoute>;

            this.app[typeRoute](path, handler as MiddlewareHandler);
        }
    }

    /**
     * Handles new websocket connections.
     * @param _req The request
     * @param res The response
     * @private
     * @async
     */
    private async onNewWebsocketConnection(_req: Request, res: Response): Promise<void> {
        this.log('New websocket connection detected');

        // @ts-ignore
        res.on('connection', (ws: IWebSocket<{}>) => {
            /*let newClient = new WebsocketClientManager(req, res, ws);
            this.websockets.push(newClient);

            newClient.onDestroy = () => {
                this.websockets.splice(this.websockets.indexOf(newClient), 1);
            };

            newClient.init();*/

            ws.close();
        });
    }

    private async handleAny(_req: Request, res: Response, next: MiddlewareNext): Promise<void> {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

        res.setHeader('Protocol', 'OpNet Official');
        res.setHeader('Version', '1');

        res.removeHeader('uWebSockets');

        if (typeof next === 'function') {
            next();
        }
    }
}
