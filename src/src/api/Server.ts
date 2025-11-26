import { DataConverter, DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
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
import { WSManager } from './websocket/WebSocketManager.js';
import { Handlers } from './websocket/handlers/HandlerRegistry.js';
import { IEpochDocument } from '../db/documents/interfaces/IEpochDocument.js';

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
        max_body_length: 1024 * 1024 * 8, // 8mb.
        fast_abort: true,
        max_body_buffer: 1024 * 32, // 32kb.
    });

    private readonly storage: VMStorage = new VMMongoStorage(Config);

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;

    //private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    /*private readonly opnetIdentity: OPNetIdentity = new OPNetIdentity(
        Config,
        this.currentAuthority,
    );*/

    private lastMiningEpoch: bigint = 0n;
    private lastFinalizedEpoch: bigint = -1n;

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

        // Initialize WebSocket manager
        this.initializeWebSocket();

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

        // WS - Binary protobuf WebSocket endpoint
        const wsConfig = WSManager.getWSConfig();
        this.app.ws(
            `${this.apiPrefix}/ws`,
            {
                maxPayloadLength: wsConfig.maxPayloadLength,
                idleTimeout: wsConfig.idleTimeout,
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

    /**
     * Initialize the WebSocket manager and register handlers
     */
    private initializeWebSocket(): void {
        // Get chain ID from config
        const chainId = Config.BITCOIN.NETWORK ?? 'bitcoin';

        // Initialize the WebSocket manager with config
        WSManager.initialize(this.storage, chainId, Config.API.WEBSOCKET);

        // Register all opcode handlers
        Handlers.registerAll();

        if (WSManager.isEnabled()) {
            this.log('WebSocket API initialized');
        }
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

                // Check for mining epoch change
                const currentMiningEpoch = OPNetConsensus.calculateCurrentEpoch(blockHeight);
                if (this.lastMiningEpoch !== currentMiningEpoch) {
                    this.lastMiningEpoch = currentMiningEpoch;
                    this.notifyAllRoutesOfMiningEpochChange(currentMiningEpoch);
                }

                // Check if we have entered a new epoch since last notification
                const currentEpoch = OPNetConsensus.calculateCurrentEpoch(blockHeight - 1n);
                const highestPossibleFinalizedEpoch = currentEpoch > 0n ? currentEpoch - 1n : -1n;

                if (highestPossibleFinalizedEpoch > this.lastFinalizedEpoch) {
                    this.lastFinalizedEpoch = highestPossibleFinalizedEpoch;

                    await this.notifyAllRoutesOfEpochFinalized(highestPossibleFinalizedEpoch);
                }
            } catch (e) {
                this.error(`Error processing block height change: ${(e as Error).message}`);
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

        for (const route of Object.values(DefinedRoutes)) {
            route.onBlockChange(height, header);
        }

        this.notifyWebsocketsOfBlockChange(height, header);
    }

    private notifyAllRoutesOfMiningEpochChange(newMiningEpoch: bigint): void {
        for (const route of Object.values(DefinedRoutes)) {
            try {
                route.onMiningEpochChange(newMiningEpoch);
            } catch (e) {
                this.error(`Error notifying route of mining epoch change: ${(e as Error).message}`);
            }
        }
    }

    private async notifyAllRoutesOfEpochFinalized(finalizedEpochNumber: bigint): Promise<void> {
        if (finalizedEpochNumber < 0n) return;

        try {
            // Fetch the finalized epoch data from storage
            const epochData = await this.storage.getEpochByNumber(finalizedEpochNumber);
            if (!epochData) {
                // This might happen if finalization is still in progress
                this.warn(
                    `!!!! --- Epoch ${finalizedEpochNumber} not found in storage yet --- !!!!`,
                );
                return;
            }

            // Verify we got the right epoch
            const storedEpochNumber = DataConverter.fromDecimal128(epochData.epochNumber);
            if (storedEpochNumber !== finalizedEpochNumber) {
                throw new Error(
                    `Epoch number mismatch: expected ${finalizedEpochNumber}, got ${storedEpochNumber}`,
                );
            }

            // Notify all routes with the full epoch data
            for (const route of Object.values(DefinedRoutes)) {
                try {
                    route.onEpochFinalized(finalizedEpochNumber, epochData);
                } catch (e) {
                    this.error(
                        `Error notifying route of epoch finalization: ${(e as Error).message}`,
                    );
                }
            }

            // Notify WebSocket clients
            this.notifyWebsocketsOfEpochFinalized(finalizedEpochNumber, epochData);
        } catch (e) {
            this.error(`Failed to notify routes of epoch finalization: ${(e as Error).message}`);
        }
    }

    private notifyWebsocketsOfBlockChange(
        blockHeight: bigint,
        blockHeader: BlockHeaderAPIBlockDocument,
    ): void {
        WSManager.onBlockChange(blockHeight, blockHeader);
    }

    private notifyWebsocketsOfEpochFinalized(epochNumber: bigint, epochData: IEpochDocument): void {
        WSManager.onEpochFinalized(epochNumber, epochData);
    }

    private loadRoutes(): void {
        for (const route of Object.values(DefinedRoutes)) {
            const routeData = route.getRoute(this.storage);
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
     * @param {Request} request - The upgrade request (contains headers for IP extraction)
     * @private
     */
    private onNewWebsocketConnection(websocket: Websocket, request: Request): void {
        // Register the connection with the WebSocket manager (pass request for IP extraction)
        WSManager.onConnection(websocket, request);

        // Set up message handler
        websocket.on('message', (message: ArrayBuffer) => {
            WSManager.onMessage(websocket, message).catch((error: unknown) => {
                this.error(`WebSocket message handling error: ${error}`);
            });
        });

        // Set up drain handler for backpressure
        websocket.on('drain', () => {
            WSManager.onDrain(websocket);
        });

        // Set up close handler
        websocket.on('close', (code: number, reason: ArrayBuffer) => {
            WSManager.onClose(websocket, code, reason);
        });
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
