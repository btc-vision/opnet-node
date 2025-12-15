import { parentPort, workerData } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { Db } from 'mongodb';
import { Logger, Globals } from '@btc-vision/bsi-common';

Globals.register();

import {
    WorkerMessage,
    WorkerMessageType,
    WorkerResponseType,
    ILoadPluginMessage,
    IUnloadPluginMessage,
    IEnablePluginMessage,
    IDisablePluginMessage,
    IExecuteHookMessage,
    IExecuteRouteHandlerMessage,
    IExecuteWsHandlerMessage,
    IGetSyncStateMessage,
    IResetSyncStateMessage,
    IWorkerResponse,
    IPluginLoadedResponse,
    IHookResultResponse,
    IRouteResultResponse,
    IWsResultResponse,
    IPluginErrorResponse,
    IPluginCrashedResponse,
    IWorkerReadyResponse,
    IPongResponse,
    ISyncStateUpdateResponse,
    IGetSyncStateResponse,
    IResetSyncStateResponse,
    ISerializedNetworkInfo,
    ISerializedPluginInstallState,
} from './WorkerMessages.js';
import { IPlugin } from '../interfaces/IPlugin.js';
import { IPluginMetadata } from '../interfaces/IPluginMetadata.js';
import { HookType } from '../interfaces/IPluginHooks.js';
import { PluginContext } from '../context/PluginContext.js';
import { PluginFilesystemAPI } from '../api/PluginFilesystemAPI.js';
import { PluginDatabaseAPI } from '../api/PluginDatabaseAPI.js';
import { DBManagerInstance } from '../../db/DBManager.js';
import { INetworkInfo, IPluginInstallState } from '../interfaces/IPluginInstallState.js';

/**
 * Worker data passed from parent thread
 */
interface IWorkerData {
    workerId: number;
}

/**
 * Loaded plugin instance
 */
interface ILoadedPlugin {
    id: string;
    instance: IPlugin;
    metadata: IPluginMetadata;
    context: PluginContext;
    enabled: boolean;
    networkInfo: INetworkInfo;
    syncState: IPluginInstallState | undefined;
    enabledAtBlock: bigint;
    isFirstInstall: boolean;
    dataDir: string;
}

/**
 * Route handler function type
 */
type RouteHandler = (request: unknown, response: unknown) => Promise<void> | void;

/**
 * WebSocket handler function type
 */
type WsHandler = (request: unknown, requestId: string, clientId: string) => Promise<unknown>;

/**
 * Worker ID from parent
 */
const typedWorkerData = workerData as IWorkerData | undefined;
const workerId: number = typedWorkerData?.workerId ?? 0;

/**
 * Worker logger
 */
class WorkerLogger extends Logger {
    public readonly logColor: string = '#9C27B0';
}

const logger = new WorkerLogger();

/**
 * Loaded plugins
 */
const loadedPlugins: Map<string, ILoadedPlugin> = new Map();

/**
 * Database instance (initialized on first plugin load that requires DB)
 */
let dbInstance: Db | null = null;
let dbInitializing: Promise<Db | null> | null = null;

/**
 * Initialize database connection
 */
async function initializeDatabase(): Promise<Db | null> {
    if (dbInstance) {
        return dbInstance;
    }

    if (dbInitializing) {
        return dbInitializing;
    }

    dbInitializing = (async () => {
        try {
            DBManagerInstance.setup();
            await DBManagerInstance.connect();
            dbInstance = DBManagerInstance.db;
            logger.info('Database connected');
            return dbInstance;
        } catch (error) {
            logger.error(`Failed to connect to database: ${error}`);
            return null;
        }
    })();

    return dbInitializing;
}

/**
 * Send response to parent
 */
function sendResponse(response: IWorkerResponse): void {
    parentPort?.postMessage(response);
}

/**
 * Send error response
 */
function sendError(
    requestId: string,
    pluginId: string | undefined,
    code: string,
    message: string,
    stack?: string,
): void {
    const response: IPluginErrorResponse = {
        type: WorkerResponseType.PLUGIN_ERROR,
        requestId,
        pluginId: pluginId ?? '',
        success: false,
        error: message,
        errorCode: code,
        errorMessage: message,
        errorStack: stack,
    };
    sendResponse(response);
}

/**
 * Send crash notification and write crash report to plugin directory
 */
function sendCrash(pluginId: string, code: string, message: string, stack?: string): void {
    // Send crash notification to main thread
    const response: IPluginCrashedResponse = {
        type: WorkerResponseType.PLUGIN_CRASHED,
        requestId: '',
        pluginId,
        success: false,
        error: message,
        errorCode: code,
        errorMessage: message,
        errorStack: stack,
    };
    sendResponse(response);

    // Write crash report to plugin's crashreports directory
    const plugin = loadedPlugins.get(pluginId);
    if (plugin?.dataDir) {
        try {
            const crashReportsDir = path.join(plugin.dataDir, 'crashreports');

            // Ensure crashreports directory exists
            if (!fs.existsSync(crashReportsDir)) {
                fs.mkdirSync(crashReportsDir, { recursive: true });
            }

            // Generate crash report filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const crashReportPath = path.join(crashReportsDir, `crash-${timestamp}.log`);

            // Build crash report content
            const crashReport = [
                `=== PLUGIN CRASH REPORT ===`,
                `Timestamp: ${new Date().toISOString()}`,
                `Plugin ID: ${pluginId}`,
                `Plugin Version: ${plugin.metadata.version}`,
                `Error Code: ${code}`,
                ``,
                `=== ERROR MESSAGE ===`,
                message,
                ``,
                `=== STACK TRACE ===`,
                stack || 'No stack trace available',
                ``,
                `=== PLUGIN STATE ===`,
                `Enabled: ${plugin.enabled}`,
                `Network: ${plugin.networkInfo.network}`,
                `Chain ID: ${plugin.networkInfo.chainId}`,
                `Current Block Height: ${plugin.networkInfo.currentBlockHeight}`,
                `Last Synced Block: ${plugin.syncState?.lastSyncedBlock ?? 'N/A'}`,
                `Sync Completed: ${plugin.syncState?.syncCompleted ?? 'N/A'}`,
                ``,
                `=== END CRASH REPORT ===`,
            ].join('\n');

            // Write crash report
            fs.writeFileSync(crashReportPath, crashReport, 'utf8');
            logger.info(`Crash report written to: ${crashReportPath}`);
        } catch (writeError) {
            logger.error(`Failed to write crash report for ${pluginId}: ${writeError}`);
        }
    }
}

/**
 * Deserialize network info from message
 */
function deserializeNetworkInfo(serialized: ISerializedNetworkInfo): INetworkInfo {
    return {
        chainId: BigInt(serialized.chainId),
        network: serialized.network,
        currentBlockHeight: BigInt(serialized.currentBlockHeight),
        genesisBlockHash: serialized.genesisBlockHash,
    };
}

/**
 * Deserialize install state from message
 */
function deserializeInstallState(
    serialized: ISerializedPluginInstallState | undefined,
): IPluginInstallState | undefined {
    if (!serialized) return undefined;
    return {
        pluginId: serialized.pluginId,
        installedVersion: serialized.installedVersion,
        chainId: BigInt(serialized.chainId),
        network: serialized.network,
        installedAt: serialized.installedAt,
        enabledAtBlock: BigInt(serialized.enabledAtBlock),
        lastSyncedBlock: BigInt(serialized.lastSyncedBlock),
        syncCompleted: serialized.syncCompleted,
        collections: serialized.collections,
        updatedAt: serialized.updatedAt,
    };
}

/**
 * Load a plugin from bytenode-compiled bytecode
 */
async function loadPlugin(message: ILoadPluginMessage): Promise<void> {
    const {
        requestId,
        pluginId,
        bytecode,
        metadata: metadataJson,
        dataDir,
        config: configJson,
        emitErrorOrWarning,
        networkInfo: serializedNetworkInfo,
        isFirstInstall,
        enabledAtBlock: enabledAtBlockStr,
        installState: serializedInstallState,
    } = message;

    try {
        // Parse metadata and config
        const metadata = JSON.parse(metadataJson) as unknown as IPluginMetadata;
        const config = JSON.parse(configJson) as unknown as Record<string, unknown>;

        // Deserialize network info and install state
        const networkInfo = deserializeNetworkInfo(serializedNetworkInfo);
        const enabledAtBlock = BigInt(enabledAtBlockStr);
        const syncState = deserializeInstallState(serializedInstallState);

        // Create plugin logger
        const pluginLogger = new Logger();

        // Create plugin config accessor
        const pluginConfig = {
            get: <T>(key: string, defaultValue?: T): T | undefined => {
                const value = config[key];
                return (value as T) ?? defaultValue;
            },
            set: (key: string, value: unknown): void => {
                config[key] = value;
            },
            has: (key: string): boolean => key in config,
            getAll: (): Record<string, unknown> => ({ ...config }),
        };

        // Create filesystem API
        const basePluginsDir = path.dirname(dataDir);
        const fsApi = new PluginFilesystemAPI(pluginId, basePluginsDir);

        // Create database API if plugin has database permissions
        let dbApi: PluginDatabaseAPI | undefined;
        if (metadata.permissions?.database?.enabled && metadata.permissions.database.collections) {
            const db = await initializeDatabase();
            if (db) {
                dbApi = new PluginDatabaseAPI(
                    pluginId,
                    [...metadata.permissions.database.collections],
                    db,
                );
            } else {
                logger.warn(`Plugin ${pluginId}: Database requested but connection failed`);
            }
        }

        // Plugin getter for inter-plugin communication
        const pluginGetter = (name: string): IPlugin | undefined => {
            const plugin = loadedPlugins.get(name);
            return plugin?.instance;
        };

        // Sync state getter - returns the local sync state
        const syncStateGetter = (): IPluginInstallState | undefined => {
            const plugin = loadedPlugins.get(pluginId);
            return plugin?.syncState;
        };

        // Sync state setter - updates local state and notifies main thread
        // Note: This is thread-safe within a worker since JS is single-threaded per worker.
        // The synchronous read-modify-write happens in one tick without await points.
        const syncStateSetter = (
            updates: Partial<IPluginInstallState>,
        ): Promise<void> => {
            const plugin = loadedPlugins.get(pluginId);
            if (!plugin || !plugin.syncState) {
                logger.warn(`Sync state setter called for non-existent plugin: ${pluginId}`);
                return Promise.resolve();
            }

            // Atomically update local state
            const newState: IPluginInstallState = {
                ...plugin.syncState,
                ...updates,
                updatedAt: Date.now(),
            };
            plugin.syncState = newState;

            // Send complete state update to main thread to prevent state divergence
            const updateResponse: ISyncStateUpdateResponse = {
                type: WorkerResponseType.SYNC_STATE_UPDATE,
                requestId: '',
                pluginId,
                success: true,
                // Send the actual current state values, not the partial updates
                lastSyncedBlock: newState.lastSyncedBlock.toString(),
                syncCompleted: newState.syncCompleted,
            };
            sendResponse(updateResponse);
            return Promise.resolve();
        };

        // Block height getter - returns current network height
        const blockHeightGetter = (): bigint => {
            const plugin = loadedPlugins.get(pluginId);
            return plugin?.networkInfo?.currentBlockHeight ?? 0n;
        };

        // Create plugin context with all new parameters
        const context = new PluginContext(
            metadata,
            dataDir,
            networkInfo,
            dbApi,
            fsApi,
            pluginLogger,
            pluginConfig,
            pluginGetter,
            syncStateGetter,
            syncStateSetter,
            blockHeightGetter,
            isFirstInstall,
            enabledAtBlock,
            undefined, // workerFactory
            { emitErrorOrWarning },
        );

        // Load plugin bytecode using bytenode
        const bytenode = await import('bytenode');

        // runBytecode executes the V8 bytecode buffer and returns the module exports
        const moduleExports = bytenode.runBytecode(bytecode) as Record<string, unknown>;

        // Get the plugin class from exports
        let pluginInstance: IPlugin;
        if (moduleExports && typeof moduleExports.default === 'function') {
            const PluginClass = moduleExports.default as new () => IPlugin;
            pluginInstance = new PluginClass();
        } else if (typeof moduleExports === 'function') {
            pluginInstance = new (moduleExports as new () => IPlugin)();
        } else {
            throw new Error(
                `Plugin ${pluginId} does not export a valid constructor. ` +
                    `Expected default export to be a class.`,
            );
        }

        // Store loaded plugin
        const loadedPlugin: ILoadedPlugin = {
            id: pluginId,
            instance: pluginInstance,
            metadata,
            context,
            enabled: false,
            networkInfo,
            syncState,
            enabledAtBlock,
            isFirstInstall,
            dataDir,
        };
        loadedPlugins.set(pluginId, loadedPlugin);

        // Call onLoad if defined
        if (pluginInstance.onLoad) {
            await pluginInstance.onLoad(context);
        }

        // Send success response
        const response: IPluginLoadedResponse = {
            type: WorkerResponseType.PLUGIN_LOADED,
            requestId,
            pluginId,
            success: true,
        };
        sendResponse(response);
    } catch (error) {
        const err = error as Error;
        sendError(requestId, pluginId, 'LOAD_FAILED', err.message, err.stack);
    }
}

/**
 * Unload a plugin
 */
async function unloadPlugin(message: IUnloadPluginMessage): Promise<void> {
    const { requestId, pluginId } = message;

    try {
        const plugin = loadedPlugins.get(pluginId);
        if (!plugin) {
            sendError(requestId, pluginId, 'NOT_FOUND', 'Plugin not loaded');
            return;
        }

        // Call onUnload if defined
        if (plugin.instance.onUnload) {
            await plugin.instance.onUnload();
        }

        loadedPlugins.delete(pluginId);

        sendResponse({
            type: WorkerResponseType.PLUGIN_UNLOADED,
            requestId,
            pluginId,
            success: true,
        });
    } catch (error) {
        const err = error as Error;
        sendError(requestId, pluginId, 'UNLOAD_FAILED', err.message, err.stack);
    }
}

/**
 * Enable a plugin
 */
async function enablePlugin(message: IEnablePluginMessage): Promise<void> {
    const { requestId, pluginId } = message;

    try {
        const plugin = loadedPlugins.get(pluginId);
        if (!plugin) {
            sendError(requestId, pluginId, 'NOT_FOUND', 'Plugin not loaded');
            return;
        }

        if (plugin.instance.onEnable) {
            await plugin.instance.onEnable();
        }

        plugin.enabled = true;

        sendResponse({
            type: WorkerResponseType.PLUGIN_ENABLED,
            requestId,
            pluginId,
            success: true,
        });
    } catch (error) {
        const err = error as Error;
        sendError(requestId, pluginId, 'ENABLE_FAILED', err.message, err.stack);
    }
}

/**
 * Disable a plugin
 */
async function disablePlugin(message: IDisablePluginMessage): Promise<void> {
    const { requestId, pluginId } = message;

    try {
        const plugin = loadedPlugins.get(pluginId);
        if (!plugin) {
            sendError(requestId, pluginId, 'NOT_FOUND', 'Plugin not loaded');
            return;
        }

        if (plugin.instance.onDisable) {
            await plugin.instance.onDisable();
        }

        plugin.enabled = false;

        sendResponse({
            type: WorkerResponseType.PLUGIN_DISABLED,
            requestId,
            pluginId,
            success: true,
        });
    } catch (error) {
        const err = error as Error;
        sendError(requestId, pluginId, 'DISABLE_FAILED', err.message, err.stack);
    }
}

/**
 * Execute a hook
 */
async function executeHook(message: IExecuteHookMessage): Promise<void> {
    const { requestId, pluginId, hookType, payload: payloadJson, timeoutMs } = message;
    const startTime = Date.now();

    try {
        const plugin = loadedPlugins.get(pluginId);
        if (!plugin) {
            sendError(requestId, pluginId, 'NOT_FOUND', 'Plugin not loaded');
            return;
        }

        if (!plugin.enabled) {
            sendError(requestId, pluginId, 'DISABLED', 'Plugin is disabled');
            return;
        }

        const payload = JSON.parse(payloadJson) as unknown;

        // Get the hook method
        const hookMethod = plugin.instance[hookType as keyof IPlugin];
        if (typeof hookMethod !== 'function') {
            // Hook not implemented, that's OK
            const response: IHookResultResponse = {
                type: WorkerResponseType.HOOK_RESULT,
                requestId,
                pluginId,
                hookType,
                success: true,
                durationMs: Date.now() - startTime,
            };
            sendResponse(response);
            return;
        }

        // Execute with timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Hook execution timed out')), timeoutMs);
        });

        // Call the hook based on type
        // Payload is passed directly (not wrapped) to minimize serialization overhead
        let hookPromise: Promise<unknown>;
        switch (hookType) {
            case HookType.BLOCK_PRE_PROCESS:
            case HookType.BLOCK_POST_PROCESS:
            case HookType.BLOCK_CHANGE:
            case HookType.EPOCH_CHANGE:
            case HookType.EPOCH_FINALIZED:
            case HookType.MEMPOOL_TRANSACTION:
            case HookType.REORG:
                // All hooks receive payload directly
                hookPromise = (hookMethod as (data: unknown) => Promise<void>).call(
                    plugin.instance,
                    payload,
                );
                break;
            case HookType.REINDEX_REQUIRED:
                // Returns boolean
                hookPromise = (hookMethod as (data: unknown) => Promise<boolean>).call(
                    plugin.instance,
                    payload,
                );
                break;
            case HookType.PURGE_BLOCKS: {
                // Receives fromBlock and toBlock
                const purgePayload = payload as { fromBlock: string; toBlock?: string };
                hookPromise = (
                    hookMethod as (fromBlock: bigint, toBlock?: bigint) => Promise<void>
                ).call(
                    plugin.instance,
                    BigInt(purgePayload.fromBlock),
                    purgePayload.toBlock ? BigInt(purgePayload.toBlock) : undefined,
                );
                break;
            }
            default:
                hookPromise = Promise.resolve();
        }

        const hookResult = await Promise.race([hookPromise, timeoutPromise]);

        const response: IHookResultResponse & { result?: unknown } = {
            type: WorkerResponseType.HOOK_RESULT,
            requestId,
            pluginId,
            hookType,
            success: true,
            durationMs: Date.now() - startTime,
            result: hookResult,
        };
        sendResponse(response);
    } catch (error) {
        const err = error as Error;
        const durationMs = Date.now() - startTime;

        // Report ALL errors as crashes - any hook failure is significant
        sendCrash(pluginId, 'HOOK_CRASH', `${err.name}: ${err.message}`, err.stack);

        const response: IHookResultResponse = {
            type: WorkerResponseType.HOOK_RESULT,
            requestId,
            pluginId,
            hookType,
            success: false,
            error: err.message,
            durationMs,
        };
        sendResponse(response);
    }
}

/**
 * Execute a route handler
 */
async function executeRouteHandler(message: IExecuteRouteHandlerMessage): Promise<void> {
    const { requestId, pluginId, handler, request: requestJson } = message;

    try {
        const plugin = loadedPlugins.get(pluginId);
        if (!plugin) {
            sendError(requestId, pluginId, 'NOT_FOUND', 'Plugin not loaded');
            return;
        }

        if (!plugin.enabled) {
            sendError(requestId, pluginId, 'DISABLED', 'Plugin is disabled');
            return;
        }

        const request = JSON.parse(requestJson) as unknown as Record<string, unknown>;

        // Get the handler method
        const handlerMethod = (plugin.instance as Record<string, unknown>)[handler];
        if (typeof handlerMethod !== 'function') {
            sendError(requestId, pluginId, 'HANDLER_NOT_FOUND', `Handler ${handler} not found`);
            return;
        }

        // Create response object
        let responseStatus = 200;
        let responseBody: unknown = null;

        const res = {
            status: (code: number) => {
                responseStatus = code;
                return res;
            },
            json: (body: unknown) => {
                responseBody = body;
            },
        };

        // Call handler
        const typedHandler = handlerMethod as RouteHandler;
        await typedHandler.call(plugin.instance, request, res);

        const response: IRouteResultResponse = {
            type: WorkerResponseType.ROUTE_RESULT,
            requestId,
            pluginId,
            handler,
            success: true,
            result: JSON.stringify(responseBody),
            status: responseStatus,
        };
        sendResponse(response);
    } catch (error) {
        const err = error as Error;
        const response: IRouteResultResponse = {
            type: WorkerResponseType.ROUTE_RESULT,
            requestId,
            pluginId,
            handler,
            success: false,
            error: err.message,
            result: JSON.stringify({ error: err.message }),
            status: 500,
        };
        sendResponse(response);
    }
}

/**
 * Execute a WebSocket handler
 */
async function executeWsHandler(message: IExecuteWsHandlerMessage): Promise<void> {
    const { requestId, pluginId, handler, request: requestJson, wsRequestId, clientId } = message;

    try {
        const plugin = loadedPlugins.get(pluginId);
        if (!plugin) {
            sendError(requestId, pluginId, 'NOT_FOUND', 'Plugin not loaded');
            return;
        }

        if (!plugin.enabled) {
            sendError(requestId, pluginId, 'DISABLED', 'Plugin is disabled');
            return;
        }

        const request = JSON.parse(requestJson) as unknown as Record<string, unknown>;

        // Get the handler method
        const handlerMethod = (plugin.instance as Record<string, unknown>)[handler];
        if (typeof handlerMethod !== 'function') {
            sendError(requestId, pluginId, 'HANDLER_NOT_FOUND', `Handler ${handler} not found`);
            return;
        }

        // Call handler with wsRequestId (client's request ID)
        const typedHandler = handlerMethod as WsHandler;
        const result = await typedHandler.call(
            plugin.instance,
            request,
            wsRequestId,
            clientId,
        );

        const response: IWsResultResponse = {
            type: WorkerResponseType.WS_RESULT,
            requestId,
            pluginId,
            handler,
            success: true,
            result: JSON.stringify(result),
        };
        sendResponse(response);
    } catch (error) {
        const err = error as Error;
        const response: IWsResultResponse = {
            type: WorkerResponseType.WS_RESULT,
            requestId,
            pluginId,
            handler,
            success: false,
            error: err.message,
            result: JSON.stringify({ error: err.message }),
        };
        sendResponse(response);
    }
}

/**
 * Get plugin sync state
 */
function getSyncState(message: IGetSyncStateMessage): void {
    const { requestId, pluginId } = message;

    const plugin = loadedPlugins.get(pluginId);
    if (!plugin) {
        const response: IGetSyncStateResponse = {
            type: WorkerResponseType.GET_SYNC_STATE_RESULT,
            requestId,
            pluginId,
            success: false,
            error: 'Plugin not loaded',
        };
        sendResponse(response);
        return;
    }

    const response: IGetSyncStateResponse = {
        type: WorkerResponseType.GET_SYNC_STATE_RESULT,
        requestId,
        pluginId,
        success: true,
        lastSyncedBlock: plugin.syncState?.lastSyncedBlock?.toString(),
        syncCompleted: plugin.syncState?.syncCompleted,
    };
    sendResponse(response);
}

/**
 * Reset plugin sync state to a specific block
 */
function resetSyncState(message: IResetSyncStateMessage): void {
    const { requestId, pluginId, blockHeight } = message;

    const plugin = loadedPlugins.get(pluginId);
    if (!plugin) {
        const response: IResetSyncStateResponse = {
            type: WorkerResponseType.RESET_SYNC_STATE_RESULT,
            requestId,
            pluginId,
            success: false,
            error: 'Plugin not loaded',
        };
        sendResponse(response);
        return;
    }

    // Update local sync state
    if (plugin.syncState) {
        plugin.syncState = {
            ...plugin.syncState,
            lastSyncedBlock: BigInt(blockHeight),
            syncCompleted: false,
            updatedAt: Date.now(),
        };
    } else {
        // Create new sync state if none exists
        plugin.syncState = {
            pluginId,
            installedVersion: plugin.metadata.version,
            chainId: plugin.networkInfo.chainId,
            network: plugin.networkInfo.network,
            installedAt: Date.now(),
            enabledAtBlock: plugin.enabledAtBlock,
            lastSyncedBlock: BigInt(blockHeight),
            syncCompleted: false,
            collections: [],
            updatedAt: Date.now(),
        };
    }

    // Notify main thread of the update
    const updateResponse: ISyncStateUpdateResponse = {
        type: WorkerResponseType.SYNC_STATE_UPDATE,
        requestId: '',
        pluginId,
        success: true,
        lastSyncedBlock: blockHeight,
        syncCompleted: false,
    };
    sendResponse(updateResponse);

    // Send success response
    const response: IResetSyncStateResponse = {
        type: WorkerResponseType.RESET_SYNC_STATE_RESULT,
        requestId,
        pluginId,
        success: true,
    };
    sendResponse(response);
}

/**
 * Handle shutdown
 */
async function shutdown(): Promise<void> {
    // Unload all plugins
    for (const [pluginId, plugin] of loadedPlugins) {
        try {
            if (plugin.instance.onUnload) {
                await plugin.instance.onUnload();
            }
        } catch (error) {
            logger.error(`Error unloading plugin ${pluginId} during shutdown: ${error}`);
        }
    }
    loadedPlugins.clear();

    // Close database connection if it was initialized
    if (dbInstance) {
        try {
            await DBManagerInstance.close();
            dbInstance = null;
            dbInitializing = null;
            logger.info('Database connection closed');
        } catch (error) {
            logger.error(`Error closing database connection: ${error}`);
        }
    }

    sendResponse({
        type: WorkerResponseType.SHUTDOWN_COMPLETE,
        requestId: '',
        success: true,
    });

    // Exit the worker
    process.exit(0);
}

/**
 * Handle messages from parent
 */
function handleMessage(message: WorkerMessage): void {
    switch (message.type) {
        case WorkerMessageType.LOAD_PLUGIN:
            void loadPlugin(message);
            break;
        case WorkerMessageType.UNLOAD_PLUGIN:
            void unloadPlugin(message);
            break;
        case WorkerMessageType.ENABLE_PLUGIN:
            void enablePlugin(message);
            break;
        case WorkerMessageType.DISABLE_PLUGIN:
            void disablePlugin(message);
            break;
        case WorkerMessageType.EXECUTE_HOOK:
            void executeHook(message);
            break;
        case WorkerMessageType.EXECUTE_ROUTE_HANDLER:
            void executeRouteHandler(message);
            break;
        case WorkerMessageType.EXECUTE_WS_HANDLER:
            void executeWsHandler(message);
            break;
        case WorkerMessageType.GET_SYNC_STATE:
            getSyncState(message);
            break;
        case WorkerMessageType.RESET_SYNC_STATE:
            resetSyncState(message);
            break;
        case WorkerMessageType.SHUTDOWN:
            void shutdown();
            break;
        case WorkerMessageType.PING:
            sendResponse({
                type: WorkerResponseType.PONG,
                requestId: message.requestId,
                success: true,
            });
            break;
        default:
            logger.warn(`Unknown message type: ${(message as WorkerMessage).type}`);
    }
}

// Set up message handler
parentPort?.on('message', handleMessage);

// Send ready message
const readyResponse: IWorkerReadyResponse = {
    type: WorkerResponseType.READY,
    requestId: '',
    workerId,
    success: true,
};
sendResponse(readyResponse);

logger.info(`Plugin worker ${workerId} started`);
