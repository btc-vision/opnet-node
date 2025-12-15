import { Logger } from '@btc-vision/bsi-common';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
    WorkerMessage,
    WorkerResponse,
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
    IGetSyncStateResponse,
    IPluginLoadedResponse,
    IHookResultResponse,
    IRouteResultResponse,
    IWsResultResponse,
    IPluginErrorResponse,
    IPluginCrashedResponse,
    ISyncStateUpdateResponse,
    ISerializedNetworkInfo,
    ISerializedPluginInstallState,
    generateRequestId,
} from './WorkerMessages.js';
import { HookType, HookPayload } from '../interfaces/IPluginHooks.js';
import { IRegisteredPlugin, PluginState } from '../interfaces/IPluginState.js';
import { INetworkInfo, IPluginInstallState } from '../interfaces/IPluginInstallState.js';

/**
 * Pending request tracking
 */
interface IPendingRequest {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
    pluginId?: string;
}

/**
 * Worker info
 */
interface IWorkerInfo {
    worker: Worker;
    id: number;
    plugins: Set<string>;
    ready: boolean;
    pendingRequests: Map<string, IPendingRequest>;
    lastActivity: number;
}

/**
 * Worker pool configuration
 */
export interface IWorkerPoolConfig {
    /** Number of workers (default: CPU cores / 2) */
    workerCount?: number;
    /** Default timeout for requests (ms) */
    defaultTimeoutMs?: number;
    /** Path to worker script */
    workerScript?: string;
    /** Whether to emit error/warning logs from plugins */
    emitErrorOrWarning?: boolean;
}

/**
 * Plugin Worker Pool
 */
export class PluginWorkerPool extends Logger {
    public readonly logColor: string = '#2196F3';

    private readonly workers: Map<number, IWorkerInfo> = new Map();
    private readonly pluginWorkerMap: Map<string, number> = new Map();
    private readonly config: Required<IWorkerPoolConfig>;

    private nextWorkerId = 0;
    private isShuttingDown = false;

    /** Callback when a plugin crashes */
    public onPluginCrash?: (pluginId: string, error: string) => void;

    /** Callback when a plugin updates its sync state */
    public onSyncStateUpdate?: (pluginId: string, lastSyncedBlock?: bigint, syncCompleted?: boolean) => void;

    constructor(config: IWorkerPoolConfig = {}) {
        super();

        this.config = {
            workerCount: config.workerCount ?? Math.max(1, Math.floor(os.cpus().length / 2)),
            defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
            workerScript:
                config.workerScript ??
                path.join(__dirname, 'PluginWorkerThread.js'),
            emitErrorOrWarning: config.emitErrorOrWarning ?? false,
        };
    }

    /**
     * Initialize the worker pool
     */
    public async initialize(): Promise<void> {
        this.info(`Initializing worker pool with ${this.config.workerCount} workers`);

        const workerPromises: Promise<void>[] = [];

        for (let i = 0; i < this.config.workerCount; i++) {
            workerPromises.push(this.createWorker());
        }

        await Promise.all(workerPromises);
        this.info('Worker pool initialized');
    }

    /**
     * Shutdown the worker pool
     */
    public async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        this.info('Shutting down worker pool');

        const shutdownPromises: Promise<void>[] = [];

        for (const workerInfo of this.workers.values()) {
            shutdownPromises.push(this.shutdownWorker(workerInfo));
        }

        await Promise.all(shutdownPromises);
        this.workers.clear();
        this.pluginWorkerMap.clear();
        this.info('Worker pool shutdown complete');
    }

    /**
     * Serialize network info for worker message
     */
    private serializeNetworkInfo(networkInfo: INetworkInfo): ISerializedNetworkInfo {
        return {
            chainId: networkInfo.chainId.toString(),
            network: networkInfo.network,
            currentBlockHeight: networkInfo.currentBlockHeight.toString(),
            genesisBlockHash: networkInfo.genesisBlockHash,
        };
    }

    /**
     * Serialize install state for worker message
     */
    private serializeInstallState(
        state: IPluginInstallState | undefined,
    ): ISerializedPluginInstallState | undefined {
        if (!state) return undefined;
        return {
            pluginId: state.pluginId,
            installedVersion: state.installedVersion,
            chainId: state.chainId.toString(),
            network: state.network,
            installedAt: state.installedAt,
            enabledAtBlock: state.enabledAtBlock.toString(),
            lastSyncedBlock: state.lastSyncedBlock.toString(),
            syncCompleted: state.syncCompleted,
            collections: state.collections,
            updatedAt: state.updatedAt,
        };
    }

    /**
     * Load a plugin into a worker
     */
    public async loadPlugin(
        plugin: IRegisteredPlugin,
        config: Record<string, unknown>,
        networkInfo: INetworkInfo,
    ): Promise<void> {
        const workerId = this.selectWorkerForPlugin(plugin);
        const workerInfo = this.workers.get(workerId);

        if (!workerInfo) {
            throw new Error(`Worker ${workerId} not found`);
        }

        const message: ILoadPluginMessage = {
            type: WorkerMessageType.LOAD_PLUGIN,
            requestId: generateRequestId(),
            pluginId: plugin.id,
            bytecode: plugin.file.bytecode,
            metadata: JSON.stringify(plugin.metadata),
            dataDir: plugin.filePath.replace(/\.opnet$/, ''),
            config: JSON.stringify(config),
            emitErrorOrWarning: this.config.emitErrorOrWarning,
            networkInfo: this.serializeNetworkInfo(networkInfo),
            isFirstInstall: plugin.isFirstInstall ?? false,
            enabledAtBlock: (plugin.enabledAtBlock ?? 0n).toString(),
            installState: this.serializeInstallState(plugin.installState),
        };

        const response = await this.sendMessage(workerInfo, message);

        if (!response.success) {
            throw new Error(response.error || 'Failed to load plugin');
        }

        workerInfo.plugins.add(plugin.id);
        this.pluginWorkerMap.set(plugin.id, workerId);
        this.info(`Loaded plugin ${plugin.id} into worker ${workerId}`);
    }

    /**
     * Unload a plugin from its worker
     */
    public async unloadPlugin(pluginId: string): Promise<void> {
        const workerId = this.pluginWorkerMap.get(pluginId);
        if (workerId === undefined) {
            return;
        }

        const workerInfo = this.workers.get(workerId);
        if (!workerInfo) {
            return;
        }

        const message: IUnloadPluginMessage = {
            type: WorkerMessageType.UNLOAD_PLUGIN,
            requestId: generateRequestId(),
            pluginId,
        };

        try {
            await this.sendMessage(workerInfo, message);
        } catch (error) {
            this.warn(`Error unloading plugin ${pluginId}: ${error}`);
        }

        workerInfo.plugins.delete(pluginId);
        this.pluginWorkerMap.delete(pluginId);
        this.info(`Unloaded plugin ${pluginId} from worker ${workerId}`);
    }

    /**
     * Enable a plugin
     */
    public async enablePlugin(pluginId: string): Promise<void> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IEnablePluginMessage = {
            type: WorkerMessageType.ENABLE_PLUGIN,
            requestId: generateRequestId(),
            pluginId,
        };

        const response = await this.sendMessage(workerInfo, message);

        if (!response.success) {
            throw new Error(response.error || 'Failed to enable plugin');
        }
    }

    /**
     * Disable a plugin
     */
    public async disablePlugin(pluginId: string): Promise<void> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IDisablePluginMessage = {
            type: WorkerMessageType.DISABLE_PLUGIN,
            requestId: generateRequestId(),
            pluginId,
        };

        const response = await this.sendMessage(workerInfo, message);

        if (!response.success) {
            throw new Error(response.error || 'Failed to disable plugin');
        }
    }

    /**
     * Execute a hook on a plugin
     */
    public async executeHook(
        pluginId: string,
        hookType: HookType,
        payload: HookPayload,
        timeoutMs?: number,
    ): Promise<IHookResultResponse> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IExecuteHookMessage = {
            type: WorkerMessageType.EXECUTE_HOOK,
            requestId: generateRequestId(),
            pluginId,
            hookType,
            payload: JSON.stringify(payload),
            timeoutMs: timeoutMs ?? this.config.defaultTimeoutMs,
        };

        const response = await this.sendMessage(
            workerInfo,
            message,
            timeoutMs ?? this.config.defaultTimeoutMs,
        );

        return response as IHookResultResponse;
    }

    /**
     * Execute a route handler on a plugin
     */
    public async executeRouteHandler(
        pluginId: string,
        handler: string,
        request: Record<string, unknown>,
    ): Promise<IRouteResultResponse> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IExecuteRouteHandlerMessage = {
            type: WorkerMessageType.EXECUTE_ROUTE_HANDLER,
            requestId: generateRequestId(),
            pluginId,
            handler,
            request: JSON.stringify(request),
        };

        const response = await this.sendMessage(workerInfo, message);

        return response as IRouteResultResponse;
    }

    /**
     * Execute a WebSocket handler on a plugin
     */
    public async executeWsHandler(
        pluginId: string,
        handler: string,
        request: unknown,
        requestId: string,
        clientId: string,
    ): Promise<IWsResultResponse> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IExecuteWsHandlerMessage = {
            type: WorkerMessageType.EXECUTE_WS_HANDLER,
            requestId: generateRequestId(),
            pluginId,
            handler,
            request: JSON.stringify(request),
            wsRequestId: requestId,
            clientId,
        };

        const response = await this.sendMessage(workerInfo, message);

        return response as IWsResultResponse;
    }

    /**
     * Execute a hook on a plugin and return the result value
     * Used for hooks that return values (like onReindexRequired which returns boolean)
     */
    public async executeHookWithResult(
        pluginId: string,
        hookType: HookType,
        payload: HookPayload,
        timeoutMs?: number,
    ): Promise<IHookResultResponse & { result?: unknown }> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IExecuteHookMessage = {
            type: WorkerMessageType.EXECUTE_HOOK,
            requestId: generateRequestId(),
            pluginId,
            hookType,
            payload: JSON.stringify(payload),
            timeoutMs: timeoutMs ?? this.config.defaultTimeoutMs,
        };

        const response = await this.sendMessage(
            workerInfo,
            message,
            timeoutMs ?? this.config.defaultTimeoutMs,
        );

        return response as IHookResultResponse & { result?: unknown };
    }

    /**
     * Get a plugin's sync state from its worker
     */
    public async getPluginSyncState(
        pluginId: string,
    ): Promise<{ lastSyncedBlock: bigint; syncCompleted: boolean } | undefined> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IGetSyncStateMessage = {
            type: WorkerMessageType.GET_SYNC_STATE,
            requestId: generateRequestId(),
            pluginId,
        };

        const response = (await this.sendMessage(workerInfo, message)) as IGetSyncStateResponse;

        if (!response.success || response.lastSyncedBlock === undefined) {
            return undefined;
        }

        return {
            lastSyncedBlock: BigInt(response.lastSyncedBlock),
            syncCompleted: response.syncCompleted ?? false,
        };
    }

    /**
     * Reset a plugin's sync state to a specific block
     */
    public async resetPluginSyncState(pluginId: string, blockHeight: bigint): Promise<void> {
        const workerInfo = this.getWorkerForPlugin(pluginId);

        const message: IResetSyncStateMessage = {
            type: WorkerMessageType.RESET_SYNC_STATE,
            requestId: generateRequestId(),
            pluginId,
            blockHeight: blockHeight.toString(),
        };

        const response = await this.sendMessage(workerInfo, message);

        if (!response.success) {
            throw new Error(response.error || `Failed to reset sync state for ${pluginId}`);
        }
    }

    /**
     * Get statistics about the worker pool
     */
    public getStats(): {
        workerCount: number;
        totalPlugins: number;
        pluginsPerWorker: Record<number, number>;
    } {
        const pluginsPerWorker: Record<number, number> = {};
        let totalPlugins = 0;

        for (const [id, info] of this.workers) {
            pluginsPerWorker[id] = info.plugins.size;
            totalPlugins += info.plugins.size;
        }

        return {
            workerCount: this.workers.size,
            totalPlugins,
            pluginsPerWorker,
        };
    }

    /**
     * Create a new worker
     */
    private async createWorker(): Promise<void> {
        const workerId = this.nextWorkerId++;

        return new Promise((resolve, reject) => {
            const worker = new Worker(this.config.workerScript, {
                workerData: { workerId },
            });

            const workerInfo: IWorkerInfo = {
                worker,
                id: workerId,
                plugins: new Set(),
                ready: false,
                pendingRequests: new Map(),
                lastActivity: Date.now(),
            };

            // Handle messages from worker
            worker.on('message', (response: WorkerResponse) => {
                this.handleWorkerMessage(workerInfo, response);
            });

            // Handle worker errors
            worker.on('error', (error) => {
                this.error(`Worker ${workerId} error: ${error}`);
                this.handleWorkerCrash(workerInfo, error);
            });

            // Handle worker exit
            worker.on('exit', (code) => {
                if (code !== 0 && !this.isShuttingDown) {
                    this.error(`Worker ${workerId} exited with code ${code}`);
                    this.handleWorkerCrash(workerInfo, new Error(`Worker exited with code ${code}`));
                }
            });

            // Wait for ready message
            const readyTimeout = setTimeout(() => {
                reject(new Error(`Worker ${workerId} failed to become ready`));
            }, 30000);

            const readyHandler = (response: WorkerResponse) => {
                if (response.type === WorkerResponseType.READY) {
                    clearTimeout(readyTimeout);
                    workerInfo.ready = true;
                    this.workers.set(workerId, workerInfo);
                    this.info(`Worker ${workerId} ready`);
                    resolve();
                }
            };

            worker.once('message', readyHandler);
        });
    }

    /**
     * Shutdown a worker
     */
    private async shutdownWorker(workerInfo: IWorkerInfo): Promise<void> {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                void workerInfo.worker.terminate();
                resolve();
            }, 5000);

            workerInfo.worker.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });

            workerInfo.worker.postMessage({
                type: WorkerMessageType.SHUTDOWN,
                requestId: generateRequestId(),
            });
        });
    }

    /**
     * Send a message to a worker and wait for response
     */
    private sendMessage(
        workerInfo: IWorkerInfo,
        message: WorkerMessage,
        timeoutMs: number = this.config.defaultTimeoutMs,
        transferList?: ArrayBuffer[],
    ): Promise<WorkerResponse> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                workerInfo.pendingRequests.delete(message.requestId);
                reject(new Error(`Request ${message.requestId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            const pending: IPendingRequest = {
                resolve,
                reject,
                timeoutId,
                pluginId: message.pluginId,
            };

            workerInfo.pendingRequests.set(message.requestId, pending);
            if (transferList && transferList.length > 0) {
                workerInfo.worker.postMessage(message, transferList);
            } else {
                workerInfo.worker.postMessage(message);
            }
            workerInfo.lastActivity = Date.now();
        });
    }

    /**
     * Handle a message from a worker
     */
    private handleWorkerMessage(workerInfo: IWorkerInfo, response: WorkerResponse): void {
        workerInfo.lastActivity = Date.now();

        // Handle plugin crash notifications
        if (response.type === WorkerResponseType.PLUGIN_CRASHED) {
            const crashResponse = response as IPluginCrashedResponse;
            this.handlePluginCrash(crashResponse.pluginId, crashResponse.errorMessage);
        }

        // Handle sync state updates
        if (response.type === WorkerResponseType.SYNC_STATE_UPDATE) {
            const syncResponse = response as ISyncStateUpdateResponse;
            this.handleSyncStateUpdate(
                syncResponse.pluginId,
                syncResponse.lastSyncedBlock,
                syncResponse.syncCompleted,
            );
        }

        // Handle pending request responses
        const pending = workerInfo.pendingRequests.get(response.requestId);
        if (pending) {
            clearTimeout(pending.timeoutId);
            workerInfo.pendingRequests.delete(response.requestId);
            pending.resolve(response);
        }
    }

    /**
     * Handle a sync state update from a plugin
     */
    private handleSyncStateUpdate(
        pluginId: string,
        lastSyncedBlockStr?: string,
        syncCompleted?: boolean,
    ): void {
        const lastSyncedBlock = lastSyncedBlockStr ? BigInt(lastSyncedBlockStr) : undefined;

        if (this.onSyncStateUpdate) {
            this.onSyncStateUpdate(pluginId, lastSyncedBlock, syncCompleted);
        }
    }

    /**
     * Handle a worker crash
     */
    private handleWorkerCrash(workerInfo: IWorkerInfo, error: Error): void {
        // Reject all pending requests
        for (const [requestId, pending] of workerInfo.pendingRequests) {
            clearTimeout(pending.timeoutId);
            pending.reject(error);
        }
        workerInfo.pendingRequests.clear();

        // Notify about plugin crashes
        for (const pluginId of workerInfo.plugins) {
            this.handlePluginCrash(pluginId, error.message);
        }

        // Remove worker and try to recreate
        this.workers.delete(workerInfo.id);

        if (!this.isShuttingDown) {
            this.warn(`Recreating worker ${workerInfo.id} after crash`);
            this.createWorker().catch((e: unknown) => {
                this.error(`Failed to recreate worker: ${e}`);
            });
        }
    }

    /**
     * Handle a plugin crash
     */
    private handlePluginCrash(pluginId: string, error: string): void {
        this.error(`Plugin ${pluginId} crashed: ${error}`);
        this.pluginWorkerMap.delete(pluginId);

        if (this.onPluginCrash) {
            this.onPluginCrash(pluginId, error);
        }
    }

    /**
     * Select the best worker for a new plugin
     */
    private selectWorkerForPlugin(plugin: IRegisteredPlugin): number {
        let bestWorkerId = 0;
        let minPlugins = Infinity;

        for (const [id, info] of this.workers) {
            if (info.ready && info.plugins.size < minPlugins) {
                minPlugins = info.plugins.size;
                bestWorkerId = id;
            }
        }

        return bestWorkerId;
    }

    /**
     * Get the worker for a plugin
     */
    private getWorkerForPlugin(pluginId: string): IWorkerInfo {
        const workerId = this.pluginWorkerMap.get(pluginId);
        if (workerId === undefined) {
            throw new Error(`Plugin ${pluginId} is not loaded in any worker`);
        }

        const workerInfo = this.workers.get(workerId);
        if (!workerInfo) {
            throw new Error(`Worker ${workerId} not found for plugin ${pluginId}`);
        }

        return workerInfo;
    }
}
