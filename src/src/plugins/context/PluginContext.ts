import { IPlugin } from '../interfaces/IPlugin.js';
import { IPluginMetadata } from '../interfaces/IPluginMetadata.js';
import { IPluginPermissions } from '../interfaces/IPluginPermissions.js';
import {
    INetworkInfo,
    IPluginInstallState,
    IPluginSyncCheck,
    IReindexCheck,
    IReindexInfo,
    PluginSyncStatus,
    ReindexAction,
} from '../interfaces/IPluginInstallState.js';
import { IPluginBlockchainAPI } from '../api/PluginBlockchainAPI.js';

/**
 * Plugin logger interface
 */
export interface IPluginLogger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

/**
 * Plugin configuration interface
 */
export interface IPluginConfig {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    set(key: string, value: unknown): void;
    has(key: string): boolean;
    getAll(): Record<string, unknown>;
}

/**
 * Plugin database API interface
 */
export interface IPluginDatabaseAPI {
    collection(name: string): IPluginCollection;
    listCollections(): string[];
}

/**
 * Plugin collection interface (subset of MongoDB collection)
 */
export interface IPluginCollection {
    find(query: Record<string, unknown>): IPluginCursor;
    findOne(query: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    insertOne(doc: Record<string, unknown>): Promise<{ insertedId: string }>;
    insertMany(docs: Record<string, unknown>[]): Promise<{ insertedIds: string[] }>;
    updateOne(
        query: Record<string, unknown>,
        update: Record<string, unknown>,
    ): Promise<{ modifiedCount: number }>;
    updateMany(
        query: Record<string, unknown>,
        update: Record<string, unknown>,
    ): Promise<{ modifiedCount: number }>;
    deleteOne(query: Record<string, unknown>): Promise<{ deletedCount: number }>;
    deleteMany(query: Record<string, unknown>): Promise<{ deletedCount: number }>;
    countDocuments(query?: Record<string, unknown>): Promise<number>;
    createIndex(
        keys: Record<string, 1 | -1>,
        options?: { name?: string; unique?: boolean; sparse?: boolean },
    ): Promise<string>;
}

/**
 * Plugin cursor interface
 */
export interface IPluginCursor {
    toArray(): Promise<Record<string, unknown>[]>;
    limit(count: number): IPluginCursor;
    skip(count: number): IPluginCursor;
    sort(spec: Record<string, 1 | -1>): IPluginCursor;
}

/**
 * Plugin filesystem API interface
 */
export interface IPluginFilesystemAPI {
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    unlink(path: string): Promise<void>;
    stat(path: string): Promise<{ size: number; isDirectory: boolean; mtime: Date }>;
}

/**
 * Plugin worker interface for spawning sub-workers
 */
export interface IPluginWorker {
    postMessage(message: unknown): void;
    on(event: 'message', handler: (message: unknown) => void): void;
    on(event: 'error', handler: (error: Error) => void): void;
    on(event: 'exit', handler: (code: number) => void): void;
    terminate(): Promise<number>;
}

/**
 * Event handler type
 */
export type EventHandler = (data: unknown) => void | Promise<void>;

/**
 * Plugin context options
 */
export interface IPluginContextOptions {
    emitErrorOrWarning?: boolean;
}

/**
 * Sync state getter function type
 */
export type SyncStateGetter = () => IPluginInstallState | undefined;

/**
 * Sync state setter function type
 */
export type SyncStateSetter = (state: Partial<IPluginInstallState>) => Promise<void>;

/**
 * Block height getter function type
 */
export type BlockHeightGetter = () => bigint;

/**
 * Plugin context - provided to plugins on load
 * This is the main API surface available to plugins
 */
export class PluginContext {
    /** Plugin name */
    public readonly name: string;

    /** Plugin version */
    public readonly version: string;

    /** Plugin data directory */
    public readonly dataDir: string;

    /** Plugin permissions */
    public readonly permissions: IPluginPermissions;

    /** Network information */
    public readonly network: INetworkInfo;

    /** Database API (if permitted) */
    public readonly db?: IPluginDatabaseAPI;

    /** Blockchain query API (if permitted) */
    public readonly blockchain?: IPluginBlockchainAPI;

    /** Filesystem API */
    public readonly fs: IPluginFilesystemAPI;

    /** Logger */
    public readonly logger: IPluginLogger;

    /** Configuration */
    public readonly config: IPluginConfig;

    /** Whether this is the first installation of this plugin */
    public readonly isFirstInstall: boolean;

    /** Block height when plugin was enabled (0 = from genesis) */
    public readonly enabledAtBlock: bigint;

    /** Event emitter for inter-plugin communication */
    private readonly eventHandlers: Map<string, Set<EventHandler>> = new Map();

    /** Reference to get other plugins */
    private readonly pluginGetter: (name: string) => IPlugin | undefined;

    /** Worker factory (if permitted) */
    private readonly workerFactory?: (script: string) => IPluginWorker;

    /** Whether to log emit errors and warnings */
    private readonly emitErrorOrWarning: boolean;

    /** Function to get sync state */
    private readonly syncStateGetter: SyncStateGetter;

    /** Function to update sync state */
    private readonly syncStateSetter: SyncStateSetter;

    /** Function to get current block height */
    private readonly blockHeightGetter: BlockHeightGetter;

    constructor(
        metadata: IPluginMetadata,
        dataDir: string,
        networkInfo: INetworkInfo,
        db: IPluginDatabaseAPI | undefined,
        blockchain: IPluginBlockchainAPI | undefined,
        fs: IPluginFilesystemAPI,
        logger: IPluginLogger,
        config: IPluginConfig,
        pluginGetter: (name: string) => IPlugin | undefined,
        syncStateGetter: SyncStateGetter,
        syncStateSetter: SyncStateSetter,
        blockHeightGetter: BlockHeightGetter,
        isFirstInstall: boolean,
        enabledAtBlock: bigint,
        workerFactory?: (script: string) => IPluginWorker,
        options?: IPluginContextOptions,
    ) {
        this.name = metadata.name;
        this.version = metadata.version;
        this.dataDir = dataDir;
        this.permissions = metadata.permissions ?? {};
        this.network = networkInfo;
        this.db = db;
        this.blockchain = blockchain;
        this.fs = fs;
        this.logger = logger;
        this.config = config;
        this.pluginGetter = pluginGetter;
        this.workerFactory = workerFactory;
        this.emitErrorOrWarning = options?.emitErrorOrWarning ?? false;
        this.syncStateGetter = syncStateGetter;
        this.syncStateSetter = syncStateSetter;
        this.blockHeightGetter = blockHeightGetter;
        this.isFirstInstall = isFirstInstall;
        this.enabledAtBlock = enabledAtBlock;
    }

    /**
     * Get another plugin instance for inter-plugin communication
     * Only works for library plugins that the current plugin depends on
     */
    public getPlugin<T extends IPlugin>(name: string): T | undefined {
        return this.pluginGetter(name) as T | undefined;
    }

    /**
     * Emit an event to other plugins
     */
    public emit(event: string, data: unknown): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    void handler(data);
                } catch (error) {
                    if (this.emitErrorOrWarning) {
                        const err = error as Error;
                        this.logger.error(
                            `[${this.name}] Error in event handler for '${event}': ${err.message}`,
                            err.stack,
                        );
                    }
                }
            }
        }
    }

    /**
     * Subscribe to events from other plugins
     */
    public on(event: string, handler: EventHandler): void {
        let handlers = this.eventHandlers.get(event);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(event, handlers);
        }
        handlers.add(handler);
    }

    /**
     * Unsubscribe from events
     */
    public off(event: string, handler: EventHandler): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * Create a worker thread (if threading permission granted)
     */
    public createWorker(script: string): IPluginWorker {
        if (!this.workerFactory) {
            throw new Error('Threading permission not granted');
        }
        return this.workerFactory(script);
    }

    /**
     * Get the current chain block height
     */
    public getCurrentBlockHeight(): bigint {
        return this.blockHeightGetter();
    }

    /**
     * Get the plugin's sync state
     */
    public getSyncState(): IPluginInstallState | undefined {
        return this.syncStateGetter();
    }

    /**
     * Get the last block the plugin processed
     */
    public getLastSyncedBlock(): bigint {
        const state = this.syncStateGetter();
        return state?.lastSyncedBlock ?? 0n;
    }

    /**
     * Check if the plugin is synced with the chain
     */
    public isSynced(): boolean {
        const state = this.syncStateGetter();
        if (!state) return false;
        const currentHeight = this.blockHeightGetter();
        return state.lastSyncedBlock >= currentHeight;
    }

    /**
     * Get sync status information
     */
    public getSyncStatus(): IPluginSyncCheck {
        const state = this.syncStateGetter();
        const chainTip = this.blockHeightGetter();

        if (!state) {
            return {
                status: PluginSyncStatus.NEVER_SYNCED,
                lastSyncedBlock: 0n,
                chainTip,
                blocksBehind: chainTip,
                requiresSync: true,
            };
        }

        const blocksBehind = chainTip - state.lastSyncedBlock;

        if (state.syncCompleted && blocksBehind <= 0n) {
            return {
                status: PluginSyncStatus.SYNCED,
                lastSyncedBlock: state.lastSyncedBlock,
                chainTip,
                blocksBehind: 0n,
                requiresSync: false,
            };
        }

        return {
            status: PluginSyncStatus.BEHIND,
            lastSyncedBlock: state.lastSyncedBlock,
            chainTip,
            blocksBehind: blocksBehind > 0n ? blocksBehind : 0n,
            requiresSync: blocksBehind > 0n,
        };
    }

    /**
     * Update the last synced block
     * Call this after processing a block to track sync progress
     */
    public async updateLastSyncedBlock(blockHeight: bigint): Promise<void> {
        await this.syncStateSetter({
            lastSyncedBlock: blockHeight,
            updatedAt: Date.now(),
        });
    }

    /**
     * Mark sync as completed
     */
    public async markSyncCompleted(): Promise<void> {
        const currentHeight = this.blockHeightGetter();
        await this.syncStateSetter({
            lastSyncedBlock: currentHeight,
            syncCompleted: true,
            updatedAt: Date.now(),
        });
    }

    /**
     * Check if reindex mode is enabled
     */
    public isReindexEnabled(): boolean {
        return this.network.reindex?.enabled ?? false;
    }

    /**
     * Get reindex information (if enabled)
     */
    public getReindexInfo(): IReindexInfo | undefined {
        return this.network.reindex;
    }

    /**
     * Get the reindex target block (block to reindex from)
     * Returns undefined if reindex is not enabled
     */
    public getReindexFromBlock(): bigint | undefined {
        return this.network.reindex?.enabled ? this.network.reindex.fromBlock : undefined;
    }

    /**
     * Check what reindex action is required for this plugin
     * This determines whether the plugin needs to purge data, sync, or both
     */
    public getReindexCheck(): IReindexCheck | undefined {
        const reindexInfo = this.network.reindex;
        if (!reindexInfo?.enabled) {
            return undefined;
        }

        const state = this.syncStateGetter();
        const lastSyncedBlock = state?.lastSyncedBlock ?? 0n;
        const reindexFromBlock = reindexInfo.fromBlock;

        // Determine the action required
        let action: ReindexAction;
        let requiresPurge = false;
        let purgeToBlock: bigint | undefined;
        let requiresSync = false;
        let syncFromBlock: bigint | undefined;
        let syncToBlock: bigint | undefined;

        if (lastSyncedBlock > reindexFromBlock) {
            // Plugin has data beyond reindex point - needs to purge
            action = ReindexAction.PURGE;
            requiresPurge = true;
            purgeToBlock = reindexFromBlock;
            // After purge, will need to sync from reindex point
            requiresSync = true;
            syncFromBlock = reindexFromBlock;
            syncToBlock = reindexFromBlock;
        } else if (lastSyncedBlock < reindexFromBlock) {
            // Plugin is behind reindex point - just needs to sync up to it
            action = ReindexAction.SYNC;
            requiresSync = true;
            syncFromBlock = lastSyncedBlock;
            syncToBlock = reindexFromBlock;
        } else {
            // Plugin is exactly at reindex point - no action needed
            action = ReindexAction.NONE;
        }

        return {
            reindexEnabled: true,
            reindexFromBlock,
            pluginLastSyncedBlock: lastSyncedBlock,
            action,
            requiresPurge,
            purgeToBlock,
            requiresSync,
            syncFromBlock,
            syncToBlock,
        };
    }

    /**
     * Check if the plugin requires reindex handling before startup
     */
    public requiresReindexHandling(): boolean {
        const check = this.getReindexCheck();
        if (!check) return false;
        return check.action !== ReindexAction.NONE;
    }

    /**
     * Reset the plugin's sync state after a purge
     * This should be called after onPurgeBlocks to update the last synced block
     */
    public async resetSyncStateToBlock(blockHeight: bigint): Promise<void> {
        await this.syncStateSetter({
            lastSyncedBlock: blockHeight,
            syncCompleted: false,
            updatedAt: Date.now(),
        });
    }
}
