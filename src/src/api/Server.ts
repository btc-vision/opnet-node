import { DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
import cors from 'cors';
import HyperExpress, {
    MiddlewareHandler,
    MiddlewareNext,
    Request,
    Response,
    Router,
    WSRouteHandler,
    WSRouteOptions,
} from 'hyper-express';
import { Config } from '../config/Config.js';
import { VMMongoStorage } from '../vm/storage/databases/VMMongoStorage.js';
import { VMStorage } from '../vm/storage/VMStorage.js';

import { DefinedRoutes } from './routes/DefinedRoutes.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { BlockchainInfoRepository } from '../db/repositories/BlockchainInfoRepository.js';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import { Websocket } from 'hyper-express/types/components/ws/Websocket.js';
import { BlockHeaderAPIBlockDocument } from '../db/interfaces/IBlockHeaderBlockDocument.js';
import { P2PMajorVersion, P2PVersion } from '../poa/configurations/P2PVersion.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { TrustedAuthority } from '../poa/configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../poa/configurations/manager/AuthorityManager.js';
import { OPNetIdentity } from '../poa/identity/OPNetIdentity.js';

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
        max_body_length: 1024 * 1024 * 4, // 4mb.
        fast_abort: true,
        max_body_buffer: 1024 * 32, // 32kb.
    });

    private readonly storage: VMStorage = new VMMongoStorage(Config);

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    private readonly opnetIdentity: OPNetIdentity = new OPNetIdentity(
        Config,
        this.currentAuthority,
    );

    public constructor() {
        super();
    }

    private get blockchainInformationRepository(): BlockchainInfoRepository {
        if (!this.#blockchainInformationRepository) {
            throw new Error('BlockchainInformationRepository not initialized');
        }

        return this.#blockchainInformationRepository;
    }

    public async createServer(): Promise<void> {
        await this.storage.init();
        await this.setupConsensus();

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
        this.app.ws(
            `${this.apiPrefix}/live`,
            {
                maxPayloadLength: 16 * 1024 * 1024,
                idleTimeout: 4 * 3,
            } as WSRouteOptions,
            this.onNewWebsocketConnection.bind(this) as WSRouteHandler,
        );

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

    private async setupConsensus(): Promise<void> {
        if (!DBManagerInstance.db) {
            throw new Error('DBManager not initialized');
        }

        this.#blockchainInformationRepository = new BlockchainInfoRepository(DBManagerInstance.db);

        await this.listenToBlockChanges();
    }

    private globalErrorHandler(_request: Request, response: Response, _error: Error): void {
        response.status(500);

        if (Config.DEV_MODE) {
            this.error(`Error details: ${_error.stack}`);
        }

        response.json({
            error: 'Something went wrong.',
        });
    }

    private async listenToBlockChanges(): Promise<void> {
        this.blockchainInformationRepository.watchBlockChanges(async (blockHeight: bigint) => {
            try {
                OPNetConsensus.setBlockHeight(blockHeight);

                await this.notifyAllRoutesOfBlockChange(blockHeight);

                const isEpochChange = OPNetConsensus.isEpochChange(blockHeight);
                if (isEpochChange) {
                    await this.notifyAllRoutesOfEpochChange(blockHeight);
                }
            } catch (e) {
                this.error(`Error setting block height. ${(e as Error).message}`);
            }
        });

        await this.blockchainInformationRepository.getCurrentBlockAndTriggerListeners(
            Config.BITCOIN.NETWORK,
        );
    }

    private async notifyAllRoutesOfBlockChange(height: bigint): Promise<void> {
        const header: BlockHeaderAPIBlockDocument | undefined = await this.storage.getLatestBlock();
        if (!header) {
            throw new Error(`Block header not found at height ${height}.`);
        }

        /*if (height < BigInt(header.height)) {
            throw new Error(
                `Block header height (${header.height}) does not match block height (${height}).`,
            );
        }*/

        for (const route of Object.values(DefinedRoutes)) {
            route.onBlockChange(height, header);
        }

        this.notifyWebsocketsOfBlockChange(height, header);
    }

    private async notifyAllRoutesOfEpochChange(blockHeight: bigint): Promise<void> {
        if (blockHeight === 0n) return;

        const epochData = await this.storage.getLatestEpoch();
        if (!epochData) {
            throw new Error(`Epoch data not found.`);
        }

        const epochNumber = DataConverter.fromDecimal128(epochData.epochNumber);
        for (const route of Object.values(DefinedRoutes)) {
            route.onEpochChange(epochNumber, epochData);
        }
    }

    private notifyWebsocketsOfBlockChange(
        _blockHeight: bigint,
        _blockHeader: BlockHeaderAPIBlockDocument,
    ): void {
        // TODO: Implement websocket notifications.
    }

    private loadRoutes(): void {
        for (const route of Object.values(DefinedRoutes)) {
            const routeData = route.getRoute(this.storage, this.opnetIdentity);
            const path = `${this.apiPrefix}/${route.getPath()}`;

            if (Config.DEBUG_LEVEL >= DebugLevel.TRACE && Config.DEV_MODE) {
                this.log(`Loading route: ${path} (${routeData.type})`);
            }

            const typeRoute = routeData.type as HyperExpressRoute;
            const handler = routeData.handler as RouterHandler<typeof typeRoute>;

            this.app[typeRoute](path, handler as MiddlewareHandler);
        }
    }

    /**
     * Handles new websocket connections.
     * @param {Websocket} websocket
     * @private
     * @async
     */
    private onNewWebsocketConnection(websocket: Websocket): void {
        this.log('New websocket connection detected');

        /*let newClient = new WebsocketClientManager(req, res, ws);
        this.websockets.push(newClient);

        newClient.onDestroy = () => {
            this.websockets.splice(this.websockets.indexOf(newClient), 1);
        };

        newClient.init();*/

        websocket.close(1000, 'Not implemented');
    }

    private handleAny(_req: Request, res: Response, next: MiddlewareNext): void {
        if (_req.method !== 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
            res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        }

        res.setHeader('Protocol', `OP_NET ${P2PMajorVersion}`);
        res.setHeader('Version', P2PVersion);

        res.removeHeader('uWebSockets');

        if (typeof next === 'function') {
            next();
        }
    }
}
