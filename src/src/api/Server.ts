import { Globals, Logger } from '@btc-vision/bsi-common';
import cors from 'cors';
import HyperExpress, { MiddlewareHandler } from 'hyper-express';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Router } from 'hyper-express/types/components/router/Router.js';
import { Config } from '../config/Config.js';
import { VMMongoStorage } from '../vm/storage/databases/VMMongoStorage.js';
import { VMStorage } from '../vm/storage/VMStorage.js';

import { DefinedRoutes } from './routes/DefinedRoutes.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { BlockchainInformationRepository } from '../db/repositories/BlockchainInformationRepository.js';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';

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
    private app: HyperExpress.Server = new HyperExpress.Server({
        max_body_length: 1024 * 1024, // 1mb.
    });

    private readonly storage: VMStorage = new VMMongoStorage(Config);

    #blockchainInformationRepository: BlockchainInformationRepository | undefined;
    #blockHeight: bigint | undefined;

    constructor() {
        super();
    }

    private get blockchainInformationRepository(): BlockchainInformationRepository {
        if (!this.#blockchainInformationRepository) {
            throw new Error('BlockchainInformationRepository not initialized');
        }

        return this.#blockchainInformationRepository;
    }

    public async createServer(): Promise<void> {
        await this.storage.init();

        // ERROR HANDLING
        this.app.set_error_handler(this.globalErrorHandler.bind(this));

        this.app.use(this.handleAny.bind(this));
        this.app.options(
            '*',
            cors({
                origin: '*',
                methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
                preflightContinue: false,
                optionsSuccessStatus: 204,
            }),
        );

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

        await this.setupConsensus();
        await this.createServer();
    }

    private blockHeight(): bigint {
        if (this.#blockHeight === undefined) {
            throw new Error('Block height not set.');
        }

        return this.#blockHeight;
    }

    private async setupConsensus(): Promise<void> {
        if (!DBManagerInstance.db) {
            throw new Error('DBManager not initialized');
        }

        this.#blockchainInformationRepository = new BlockchainInformationRepository(
            DBManagerInstance.db,
        );

        this.blockchainInformationRepository.watchBlockChanges((blockHeight: bigint) => {
            try {
                OPNetConsensus.setBlockHeight(blockHeight);
                this.#blockHeight = blockHeight;
            } catch (e) {
                this.error(`Error setting block height.`);
            }
        });

        await this.blockchainInformationRepository.getCurrentBlockAndTriggerListeners(
            Config.BLOCKCHAIN.BITCOIND_NETWORK,
        );
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

    private async handleAny(_req: Request, res: Response, _next: MiddlewareNext): Promise<void> {
        if (_req.method !== 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
            res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        }

        res.setHeader('Protocol', 'OpNet Official');
        res.setHeader('Version', '1');

        res.removeHeader('uWebSockets');

        // I disabled this because for some reason it's calling the next method twice?
        /*if (typeof next === 'function') {
            console.log('next', next);
        }*/
    }
}
