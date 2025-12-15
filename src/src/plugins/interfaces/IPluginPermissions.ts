/**
 * Database permission configuration
 */
export interface IDatabasePermissions {
    readonly enabled: boolean;
    readonly collections: readonly string[];
    readonly indexes?: Record<string, readonly IIndexDefinition[]>;
}

/**
 * Index definition for plugin collections
 * Supports all MongoDB index types and options
 */
export interface IIndexDefinition {
    readonly keys: Record<string, 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed'>;
    readonly options?: {
        readonly name?: string;
        readonly unique?: boolean;
        readonly sparse?: boolean;
        readonly expireAfterSeconds?: number; // TTL index
        readonly weights?: Record<string, number>; // Text index weights
        readonly default_language?: string; // Text index language
        readonly partialFilterExpression?: Record<string, unknown>; // Partial index
        readonly [key: string]: unknown; // Allow other MongoDB options
    };
}

/**
 * Block processing permissions
 */
export interface IBlockPermissions {
    readonly preProcess: boolean;
    readonly postProcess: boolean;
    readonly onChange: boolean;
}

/**
 * Epoch permissions
 */
export interface IEpochPermissions {
    readonly onChange: boolean;
    readonly onFinalized: boolean;
}

/**
 * Mempool permissions
 */
export interface IMempoolPermissions {
    readonly txFeed: boolean;
    readonly txSubmit: boolean;
}

/**
 * HTTP route definition
 */
export interface IPluginRouteDefinition {
    readonly path: string;
    readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    readonly handler: string;
    readonly rateLimit?: number;
}

/**
 * WebSocket handler definition
 */
export interface IPluginWebSocketHandler {
    readonly opcode: string;
    readonly requestType: string;
    readonly responseType: string;
    readonly handler: string;
    readonly pushType?: string;
}

/**
 * WebSocket permission configuration
 */
export interface IWebSocketPermissions {
    readonly protoFile?: string;
    readonly namespace?: string;
    readonly handlers?: readonly IPluginWebSocketHandler[];
}

/**
 * API permissions
 */
export interface IApiPermissions {
    readonly addEndpoints: boolean;
    readonly addWebsocket: boolean;
    readonly basePath?: string;
    readonly routes?: readonly IPluginRouteDefinition[];
    readonly websocket?: IWebSocketPermissions;
}

/**
 * Threading permissions
 */
export interface IThreadingPermissions {
    readonly maxWorkers: number;
    readonly maxMemoryMB: number;
}

/**
 * Filesystem permissions
 */
export interface IFilesystemPermissions {
    readonly configDir: boolean;
    readonly tempDir: boolean;
}

/**
 * Blockchain query permissions
 * Controls what historical data plugins can query
 */
export interface IBlockchainPermissions {
    /** Allow querying block headers and data */
    readonly blocks: boolean;
    /** Allow querying transactions */
    readonly transactions: boolean;
    /** Allow querying contract state and events */
    readonly contracts: boolean;
    /** Allow querying UTXOs */
    readonly utxos: boolean;
}

/**
 * Complete plugin permissions configuration
 */
export interface IPluginPermissions {
    readonly database?: IDatabasePermissions;
    readonly blocks?: IBlockPermissions;
    readonly epochs?: IEpochPermissions;
    readonly mempool?: IMempoolPermissions;
    readonly api?: IApiPermissions;
    readonly threading?: IThreadingPermissions;
    readonly filesystem?: IFilesystemPermissions;
    readonly blockchain?: IBlockchainPermissions;
}

/**
 * Default permissions (most restrictive)
 */
export const DEFAULT_PERMISSIONS: IPluginPermissions = {
    database: {
        enabled: false,
        collections: [],
    },
    blocks: {
        preProcess: false,
        postProcess: false,
        onChange: false,
    },
    epochs: {
        onChange: false,
        onFinalized: false,
    },
    mempool: {
        txFeed: false,
        txSubmit: false,
    },
    api: {
        addEndpoints: false,
        addWebsocket: false,
    },
    threading: {
        maxWorkers: 1,
        maxMemoryMB: 256,
    },
    filesystem: {
        configDir: false,
        tempDir: false,
    },
    blockchain: {
        blocks: false,
        transactions: false,
        contracts: false,
        utxos: false,
    },
};
