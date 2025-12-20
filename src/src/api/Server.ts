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
import { IPluginRouteInfo, IPluginOpcodeInfo } from '../plugins/interfaces/IPluginMessages.js';

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

    private readonly pluginRoutes: Map<string, IPluginRouteInfo[]> = new Map();
    private readonly pluginOpcodes: Map<string, IPluginOpcodeInfo[]> = new Map();

    /** Callback to execute plugin routes via ServerThread */
    private pluginRouteExecutor?: (
        pluginId: string,
        handler: string,
        request: Record<string, unknown>,
    ) => Promise<{ success: boolean; status?: number; body?: unknown; error?: string }>;

    public constructor() {
        super();
    }

    /**
     * Set the plugin route executor callback
     * Called by ServerThread to enable plugin route execution
     */
    public setPluginRouteExecutor(
        executor: (
            pluginId: string,
            handler: string,
            request: Record<string, unknown>,
        ) => Promise<{ success: boolean; status?: number; body?: unknown; error?: string }>,
    ): void {
        this.pluginRouteExecutor = executor;
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
                max_backpressure: wsConfig.maxPayloadLength * 2, // Allow buffering 2x max payload before considering socket full
                message_type: 'ArrayBuffer', // Keep binary data as ArrayBuffer, don't convert to String
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
        if (Config.DEV_MODE) {
            this.error(`Error details: ${_error.stack}`);
        }

        // Check if socket is still open before writing
        if (response.closed) return;

        response.atomic(() => {
            response.status(500);
            response.json({
                error: 'Something went wrong.',
            });
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
                this.error(`Error processing block height change: ${(e as Error).stack}`);
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

    public registerPluginRoutes(routes: IPluginRouteInfo[]): void {
        for (const route of routes) {
            const fullPath = `${this.apiPrefix}/plugins/${route.pluginId}/${route.path}`;
            const handler = this.createPluginRouteHandler(route);

            const method = route.method.toLowerCase() as HyperExpressRoute;
            this.app[method](fullPath, handler);

            let pluginRouteList = this.pluginRoutes.get(route.pluginId);
            if (!pluginRouteList) {
                pluginRouteList = [];
                this.pluginRoutes.set(route.pluginId, pluginRouteList);
            }
            pluginRouteList.push(route);

            this.log(`Registered plugin route: ${route.method} ${fullPath}`);
        }
    }

    public unregisterPluginRoutes(pluginId: string): void {
        const routes = this.pluginRoutes.get(pluginId);
        if (!routes) {
            return;
        }

        // Note: HyperExpress doesn't support route removal at runtime
        // We mark the routes as inactive so the handler returns 404
        this.pluginRoutes.delete(pluginId);
        this.warn(`Plugin ${pluginId} routes marked as inactive`);
    }

    public registerPluginOpcodes(opcodes: IPluginOpcodeInfo[]): void {
        for (const opcode of opcodes) {
            let opcodeList = this.pluginOpcodes.get(opcode.pluginId);
            if (!opcodeList) {
                opcodeList = [];
                this.pluginOpcodes.set(opcode.pluginId, opcodeList);
            }
            opcodeList.push(opcode);

            this.log(
                `Registered plugin opcode: ${opcode.pluginId}/${opcode.opcodeName} -> 0x${opcode.requestOpcode.toString(16)}`,
            );
        }

        // Register with WebSocket manager
        WSManager.registerPluginOpcodes(opcodes);
    }

    public unregisterPluginOpcodes(pluginId: string): void {
        const opcodes = this.pluginOpcodes.get(pluginId);
        if (!opcodes) {
            return;
        }

        // Unregister from WebSocket manager
        WSManager.unregisterPluginOpcodes(pluginId);

        this.pluginOpcodes.delete(pluginId);
        this.log(`Unregistered opcodes for plugin ${pluginId}`);
    }

    private createPluginRouteHandler(route: IPluginRouteInfo): MiddlewareHandler {
        return async (req: Request, res: Response) => {
            // Check if plugin route is still active
            if (!this.pluginRoutes.has(route.pluginId)) {
                if (!res.closed) {
                    res.status(404).json({ error: 'Plugin route not available' });
                }
                return;
            }

            // Check if executor is available
            if (!this.pluginRouteExecutor) {
                if (!res.closed) {
                    res.status(503).json({ error: 'Plugin system not initialized' });
                }
                return;
            }

            try {
                // Build request object for plugin
                const body: unknown = await req.json().catch(() => ({}));
                const pluginRequest = {
                    method: req.method,
                    path: req.path,
                    query: req.query_parameters || {},
                    params: req.path_parameters || {},
                    body,
                    headers: this.extractHeaders(req),
                };

                // Execute via ServerThread → PluginThread
                const result = await this.pluginRouteExecutor(
                    route.pluginId,
                    route.handler,
                    pluginRequest as Record<string, unknown>,
                );

                // Check if socket is still open after async operation
                if (res.closed) return;

                if (!result.success) {
                    res.atomic(() => {
                        res.status(result.status || 500).json({
                            error: result.error || 'Plugin handler failed',
                        });
                    });
                    return;
                }

                res.atomic(() => {
                    res.status(result.status || 200).json(result.body || {});
                });
            } catch (error) {
                if (!res.closed) {
                    res.atomic(() => {
                        res.status(500).json({ error: (error as Error).message });
                    });
                }
            }
        };
    }

    private extractHeaders(req: Request): Record<string, string> {
        const headers: Record<string, string> = {};
        // HyperExpress Request has headers available
        const rawHeaders = req.headers;
        if (rawHeaders) {
            for (const [key, value] of Object.entries(rawHeaders)) {
                if (typeof value === 'string') {
                    headers[key] = value;
                }
            }
        }
        return headers;
    }
}
