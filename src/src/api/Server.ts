import cors from 'cors';
import fs from 'fs';
import nanoexpress, { IHttpRequest, IHttpResponse, IWebSocket } from 'nanoexpress';
import path from 'path';
import { Logger } from '../logger/Logger.js';
import { Globals } from '../utils/Globals.js';

Globals.register();

export class Server extends Logger {
    public logColor: string = '#00fa9a';

    private apiPrefix: string = '/api/v1';

    private serverPort: number = 0;
    private app: any = nanoexpress();

    private schemaPath: string = path.join(__dirname, '../../protocols/MotoSwap.proto');
    private schema: string = fs.readFileSync(this.schemaPath)?.toString();

    constructor() {
        super();
    }

    public createServer(): void {
        // ERROR HANDLING
        this.app.setErrorHandler(
            (err: Error, req: IHttpRequest, res: IHttpResponse): IHttpResponse => {
                res.status(500);

                return res.send({
                    error: 'Something went wrong.',
                });
            },
        );

        // USE
        this.app.use(cors());
        this.app.use('/*', this.handleAny.bind(this));

        // GET
        this.app.get(`${this.apiPrefix}/schema`, this.handleGetSchema.bind(this));

        this.app.get(`${this.apiPrefix}/test`, this.handleTest.bind(this));

        // WS
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

    /**
     * GET /api/v1/schema
     * @tag Websocket
     * @summary Get the protocol schema
     * @description Get the protocol schema for the MotoSwap packets and messages in protobuf format.
     * @response 200 - Return the protocol schema
     * @response 404 - Schema not found
     * @response 500 - Something went wrong
     * @security BearerAuth
     * @response default - Unexpected error
     * @responseContent {string} 200.plain/text
     */
    private async handleGetSchema(req: IHttpRequest, res: IHttpResponse): Promise<void> {
        let response: string | null = this.schema || null;

        if (response === null || !response) {
            res.status(404);
            res.send('No schema found');
        } else {
            res.send(response);
        }
    }

    /**
     * GET /api/v1/test
     * @tag Example API!
     * @summary Get the current heap block of MotoSwap
     * @description Get the current heap block of MotoSwap (the block that is currently being processed)
     * @response 200 - Return the current heap block of the Ethereum blockchain.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {HeapBlock} 200.application/json
     */
    private async handleTest(req: IHttpRequest, res: IHttpResponse): Promise<void> {
        try {
            res.status(200);

            res.json({ api: 'is working!' });
        } catch (err: unknown) {
            let e = err as Error;
            this.error(e.stack);
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
