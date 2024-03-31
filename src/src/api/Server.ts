import cors from 'cors';
import nanoexpress, { IHttpRequest, IHttpResponse, INanoexpressApp, IWebSocket } from 'nanoexpress';
import { Logger } from '../logger/Logger.js';
import { Globals } from '../utils/Globals.js';
import { DefinedRoutes } from './routes/DefinedRoutes.js';

Globals.register();

export class Server extends Logger {
    public logColor: string = '#00fa9a';

    private apiPrefix: string = '/api/v1';

    private serverPort: number = 0;
    private app: INanoexpressApp = nanoexpress();

    constructor() {
        super();
    }

    public createServer(): void {
        // ERROR HANDLING
        this.app.setErrorHandler(
            (_err: Error, _req: IHttpRequest, res: IHttpResponse): IHttpResponse => {
                res.status(500);

                return res.send({
                    error: 'Something went wrong.',
                });
            },
        );

        // @ts-ignore
        this.app.use(cors());

        // @ts-ignore
        this.app.use('/*', this.handleAny.bind(this));

        // GET
        this.loadRoutes();

        // WS
        // @ts-ignore
        this.app.ws(`${this.apiPrefix}/live`, this.onNewWebsocketConnection.bind(this), {
            maxPayloadLength: 16 * 1024 * 1024,
            idleTimeout: 4 * 3,
        });

        //LISTEN
        this.app.listen(this.serverPort);
        this.log(`Server listening on port ${this.serverPort}.`);
    }

    public async init(port: number | undefined): Promise<void> {
        if (port) {
            this.serverPort = port;
        }

        this.createServer();
    }

    private loadRoutes(): void {
        for (const route of Object.values(DefinedRoutes)) {
            const routeData = route.getRoute();
            const path = `${this.apiPrefix}/${route.getPath()}`;

            this.log(`Loading route: ${path} (${routeData.type})`);

            this.app[routeData.type](path, routeData.handler as any);
        }
    }

    /**
     * Handles new websocket connections.
     * @param req The request
     * @param res The response
     * @private
     * @async
     */
    private async onNewWebsocketConnection(req: IHttpRequest, res: IHttpResponse): Promise<void> {
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

    private async handleAny(req: IHttpRequest, res: IHttpResponse, next: any): Promise<void> {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

        res.setHeader('Protocol', 'RSNet Official');
        res.setHeader('Version', '1');

        res.removeHeader('uWebSockets');

        if (typeof next === 'function') {
            next();
        }
    }
}
