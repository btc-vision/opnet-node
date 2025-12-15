import { IPlugin } from '../interfaces/IPlugin.js';
import { IPluginMetadata } from '../interfaces/IPluginMetadata.js';
import { IPluginPermissions } from '../interfaces/IPluginPermissions.js';

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
    readFile(path: string): Promise<Buffer>;
    writeFile(path: string, data: Buffer | string): Promise<void>;
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

    /** Database API (if permitted) */
    public readonly db?: IPluginDatabaseAPI;

    /** Filesystem API */
    public readonly fs: IPluginFilesystemAPI;

    /** Logger */
    public readonly logger: IPluginLogger;

    /** Configuration */
    public readonly config: IPluginConfig;

    /** Event emitter for inter-plugin communication */
    private readonly eventHandlers: Map<string, Set<EventHandler>> = new Map();

    /** Reference to get other plugins */
    private readonly pluginGetter: (name: string) => IPlugin | undefined;

    /** Worker factory (if permitted) */
    private readonly workerFactory?: (script: string) => IPluginWorker;

    /** Whether to log emit errors and warnings */
    private readonly emitErrorOrWarning: boolean;

    constructor(
        metadata: IPluginMetadata,
        dataDir: string,
        db: IPluginDatabaseAPI | undefined,
        fs: IPluginFilesystemAPI,
        logger: IPluginLogger,
        config: IPluginConfig,
        pluginGetter: (name: string) => IPlugin | undefined,
        workerFactory?: (script: string) => IPluginWorker,
        options?: IPluginContextOptions,
    ) {
        this.name = metadata.name;
        this.version = metadata.version;
        this.dataDir = dataDir;
        this.permissions = metadata.permissions ?? {};
        this.db = db;
        this.fs = fs;
        this.logger = logger;
        this.config = config;
        this.pluginGetter = pluginGetter;
        this.workerFactory = workerFactory;
        this.emitErrorOrWarning = options?.emitErrorOrWarning ?? false;
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
}
