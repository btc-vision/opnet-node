import { parentPort } from 'worker_threads';
import { Network } from '@btc-vision/bitcoin';
import { Globals } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { PluginManager } from './PluginManager.js';
import { IEpochData, IReorgData } from './interfaces/IPlugin.js';
import { BlockProcessedData } from '../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import {
    IPluginOpcodeInfo,
    IPluginRouteExecuteRequest,
    IPluginRouteInfo,
    IPluginWsExecuteRequest,
} from './interfaces/IPluginMessages.js';
import { BitcoinNetwork } from '../config/network/BitcoinNetwork.js';
import { createRequire } from 'module';

// Get OPNet node version from package.json
const require = createRequire(import.meta.url);
const packageJson = require('../../../package.json') as { version: string };
const OPNET_NODE_VERSION = packageJson.version;

export class PluginThread extends Thread<ThreadTypes.PLUGIN> {
    public readonly threadType: ThreadTypes.PLUGIN = ThreadTypes.PLUGIN;

    private pluginManager?: PluginManager;

    constructor() {
        super();

        void this.init();
    }

    public async broadcastRouteRegistration(routes: IPluginRouteInfo[]): Promise<void> {
        try {
            await this.sendMessageToAllThreads(ThreadTypes.API, {
                type: MessageType.PLUGIN_REGISTER_ROUTES,
                data: { routes },
            });
            this.info(`Broadcasted ${routes.length} route(s) to API threads`);
        } catch (error) {
            this.error(`Failed to broadcast route registration: ${error}`);
        }
    }

    public async broadcastRouteUnregistration(pluginId: string): Promise<void> {
        try {
            await this.sendMessageToAllThreads(ThreadTypes.API, {
                type: MessageType.PLUGIN_UNREGISTER_ROUTES,
                data: { pluginId },
            });
            this.info(`Broadcasted route unregistration for plugin ${pluginId}`);
        } catch (error) {
            this.error(`Failed to broadcast route unregistration: ${error}`);
        }
    }

    public async broadcastOpcodeRegistration(opcodes: IPluginOpcodeInfo[]): Promise<void> {
        try {
            await this.sendMessageToAllThreads(ThreadTypes.API, {
                type: MessageType.PLUGIN_REGISTER_OPCODES,
                data: { opcodes },
            });
            this.info(`Broadcasted ${opcodes.length} opcode(s) to API threads`);
        } catch (error) {
            this.error(`Failed to broadcast opcode registration: ${error}`);
        }
    }

    public async broadcastOpcodeUnregistration(pluginId: string): Promise<void> {
        try {
            await this.sendMessageToAllThreads(ThreadTypes.API, {
                type: MessageType.PLUGIN_UNREGISTER_OPCODES,
                data: { pluginId },
            });
            this.info(`Broadcasted opcode unregistration for plugin ${pluginId}`);
        } catch (error) {
            this.error(`Failed to broadcast opcode unregistration: ${error}`);
        }
    }

    protected async init(): Promise<void> {
        Globals.register();
        this.info('Initializing plugin thread...');

        try {
            if (Config.PLUGINS.PLUGINS_ENABLED) {
                this.pluginManager = new PluginManager({
                    pluginsDir: Config.PLUGINS.PLUGINS_DIR,
                    network: Config.BITCOIN.NETWORK as unknown as Network,
                    nodeVersion: OPNET_NODE_VERSION,
                    workerPool: {
                        workerCount: Config.PLUGINS.WORKER_POOL_SIZE,
                        emitErrorOrWarning: Config.PLUGINS.EMIT_ERROR_OR_WARNING,
                    },
                    autoEnable: true,
                    chainId: BigInt(Config.BITCOIN.CHAIN_ID),
                    networkType: this.getNetworkType(),
                    genesisBlockHash: '', // Will be updated when first block is received
                    reindexEnabled: Config.OP_NET.REINDEX,
                    reindexFromBlock: BigInt(Config.OP_NET.REINDEX_FROM_BLOCK),
                });

                await this.pluginManager.initialize();

                // Handle reindex if enabled (BLOCKING)
                if (Config.OP_NET.REINDEX) {
                    await this.pluginManager.handleReindex();
                }

                const pluginCount = this.pluginManager.getAllPlugins().length;
                const enabledCount = this.pluginManager.getEnabledPlugins().length;
                this.success(
                    `Plugin system initialized: ${pluginCount} plugin(s) loaded, ${enabledCount} enabled`,
                );

                // Broadcast registered routes and opcodes to API threads
                await this.broadcastInitialRegistrations();
            } else {
                this.info('Plugin system is disabled');
            }

            // Notify main thread that plugin system is ready
            this.notifyReady();
        } catch (error) {
            this.error(`Failed to initialize plugin system: ${error}`);
            // Still notify ready even on error - Core.ts needs to know to continue
            this.notifyReady(false, String(error));
            throw error;
        }
    }

    protected async onMessage(m: ThreadMessageBase<MessageType>): Promise<void> {
        switch (m.type) {
            case MessageType.EXIT_THREAD:
                await this.shutdown();
                process.exit(0);
                break;
            default:
                this.warn(`Unknown message type received: ${m.type}`);
                break;
        }
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (type) {
            case ThreadTypes.INDEXER:
                return this.handleIndexerMessage(m);
            case ThreadTypes.API:
                return this.handleApiMessage(m);
            default:
                this.warn(`Unknown thread type sent message: ${type}`);
                return undefined;
        }
    }

    /**
     * Convert BitcoinNetwork enum to the plugin network type
     */
    private getNetworkType(): 'mainnet' | 'testnet' | 'regtest' {
        switch (Config.BITCOIN.NETWORK) {
            case BitcoinNetwork.mainnet:
                return 'mainnet';
            case BitcoinNetwork.testnet:
            case BitcoinNetwork.signet:
                return 'testnet';
            case BitcoinNetwork.regtest:
            case BitcoinNetwork.custom:
            default:
                return 'regtest';
        }
    }

    private notifyReady(success: boolean = true, error?: string): void {
        if (parentPort) {
            parentPort.postMessage({
                type: MessageType.PLUGIN_READY,
                data: { success, error },
            } as ThreadMessageBase<MessageType>);
        }
    }

    private async handleIndexerMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin system not initialized' };
        }

        switch (m.type) {
            case MessageType.PLUGIN_BLOCK_CHANGE:
                return this.handleBlockChange(m.data as BlockProcessedData);

            case MessageType.PLUGIN_REORG:
                return this.handleReorg(m.data as IReorgData);

            case MessageType.PLUGIN_EPOCH_CHANGE:
                return this.handleEpochChange(m.data);

            case MessageType.PLUGIN_EPOCH_FINALIZED:
                return this.handleEpochFinalized(m.data);

            default:
                this.warn(`Unknown indexer message type: ${m.type}`);
                return undefined;
        }
    }

    private async handleBlockChange(blockData: BlockProcessedData): Promise<ThreadData> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin manager not initialized' };
        }

        try {
            await this.pluginManager.onBlockChange(blockData);
            return { success: true };
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to dispatch block change to plugins: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    private async handleReorg(reorgData: IReorgData): Promise<ThreadData> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin manager not initialized' };
        }

        this.info(`Dispatching reorg to plugins: ${reorgData.fromBlock} -> ${reorgData.toBlock}`);

        try {
            const results = await this.pluginManager.onReorg(reorgData);

            const failures = results.filter((r) => !r.success);
            if (failures.length > 0) {
                const errors = failures.map((f) => `${f.pluginName}: ${f.error}`).join(', ');
                this.error(`Plugin reorg failures: ${errors}`);
                return { success: false, error: errors };
            }

            this.success(`Plugin reorg complete: ${results.length} plugin(s) processed`);
            return { success: true };
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to dispatch reorg to plugins: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    private async handleEpochChange(epochData: unknown): Promise<ThreadData> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin manager not initialized' };
        }

        try {
            await this.pluginManager.onEpochChange(epochData as IEpochData);
            return { success: true };
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to dispatch epoch change to plugins: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    private async handleEpochFinalized(epochData: unknown): Promise<ThreadData> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin manager not initialized' };
        }

        try {
            await this.pluginManager.onEpochFinalized(epochData as IEpochData);
            return { success: true };
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to dispatch epoch finalized to plugins: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    private async handleApiMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin system not initialized' };
        }

        switch (m.type) {
            case MessageType.PLUGIN_EXECUTE_ROUTE:
                return this.handleExecuteRoute(m.data as IPluginRouteExecuteRequest);

            case MessageType.PLUGIN_EXECUTE_WS_HANDLER:
                return this.handleExecuteWsHandler(m.data as IPluginWsExecuteRequest);

            default:
                this.warn(`Unknown API message type: ${m.type}`);
                return undefined;
        }
    }

    private async handleExecuteRoute(data: IPluginRouteExecuteRequest): Promise<ThreadData> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin manager not initialized' };
        }

        try {
            const result = await this.pluginManager.executeRouteHandler(
                data.pluginId,
                data.handler,
                data.request as Record<string, unknown>,
            );

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || 'Route handler failed',
                };
            }

            let body: unknown = null;
            if (result.result) {
                try {
                    body = JSON.parse(result.result);
                } catch (parseError) {
                    this.error(`Failed to parse route handler result: ${parseError}`);
                    return { success: false, error: 'Invalid JSON response from plugin' };
                }
            }

            return {
                success: true,
                status: result.status,
                body,
            };
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to execute route handler: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    private async handleExecuteWsHandler(data: IPluginWsExecuteRequest): Promise<ThreadData> {
        if (!this.pluginManager) {
            return { success: false, error: 'Plugin manager not initialized' };
        }

        try {
            // Use executeWsHandlerRaw which handles protobuf decode/encode
            const result = await this.pluginManager.executeWsHandlerRaw(
                data.requestOpcode,
                data.request,
                String(data.requestId),
                data.clientId,
            );

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || 'WebSocket handler failed',
                };
            }

            return {
                success: true,
                response: result.response,
            };
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to execute WebSocket handler: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Broadcast all registered routes and opcodes after plugin initialization
     */
    private async broadcastInitialRegistrations(): Promise<void> {
        if (!this.pluginManager) {
            return;
        }

        // Collect all routes from the route registry
        const allRoutes = this.pluginManager.httpRoutes.getAllRoutes();
        if (allRoutes.length > 0) {
            const routeInfos: IPluginRouteInfo[] = allRoutes.map((route) => ({
                pluginId: route.pluginId,
                path: route.path,
                method: route.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
                handler: route.handler,
            }));

            await this.broadcastRouteRegistration(routeInfos);
        }

        // Collect all opcodes from the opcode registry
        const allHandlers = this.pluginManager.websocketOpcodes.getAllHandlers();
        if (allHandlers.length > 0) {
            const opcodeInfos: IPluginOpcodeInfo[] = allHandlers.map((handler) => ({
                pluginId: handler.pluginId,
                opcodeName: handler.opcodeName,
                requestOpcode: handler.requestOpcode,
                responseOpcode: handler.responseOpcode,
                handler: handler.handler,
                requestType: handler.requestType.name,
                responseType: handler.responseType.name,
                pushType: handler.pushType?.name,
            }));

            await this.broadcastOpcodeRegistration(opcodeInfos);
        }
    }

    private async shutdown(): Promise<void> {
        if (this.pluginManager) {
            this.info('Shutting down plugin system...');
            try {
                await this.pluginManager.shutdown();
                this.success('Plugin system shutdown complete');
            } catch (error) {
                this.error(`Error shutting down plugin system: ${error}`);
            }
        }
    }
}

new PluginThread();
