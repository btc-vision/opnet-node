/**
 * Plugin installation state - persisted to database
 * Tracks plugin installation, sync status, and network configuration
 */
export interface IPluginInstallState {
    /** Plugin ID (name) */
    readonly pluginId: string;

    /** Plugin version when installed */
    readonly installedVersion: string;

    /** Chain ID the plugin is configured for */
    readonly chainId: bigint;

    /** Network type (mainnet, testnet, regtest) */
    readonly network: string;

    /** Timestamp when plugin was first installed */
    readonly installedAt: number;

    /** Block height when plugin was first enabled (0 = genesis) */
    readonly enabledAtBlock: bigint;

    /** Last block the plugin processed */
    readonly lastSyncedBlock: bigint;

    /** Whether the plugin has completed initial sync */
    readonly syncCompleted: boolean;

    /** Collections created by this plugin */
    readonly collections: readonly string[];

    /** Timestamp of last state update */
    readonly updatedAt: number;
}

/**
 * Network information provided to plugins
 */
export interface INetworkInfo {
    /** Chain ID (unique identifier for the network) */
    readonly chainId: bigint;

    /** Network type */
    readonly network: 'mainnet' | 'testnet' | 'regtest';

    /** Current block height */
    readonly currentBlockHeight: bigint;

    /** Genesis block hash */
    readonly genesisBlockHash: string;

    /** Reindex information (if reindex is active) */
    readonly reindex?: IReindexInfo;
}

/**
 * Reindex information
 */
export interface IReindexInfo {
    /** Whether reindex mode is enabled */
    readonly enabled: boolean;

    /** Block height to reindex from (0 = full reindex from genesis) */
    readonly fromBlock: bigint;

    /** Whether the reindex is currently in progress */
    readonly inProgress: boolean;
}

/**
 * Sync block data for plugin catch-up
 */
export interface ISyncBlockData {
    /** Block height */
    readonly blockHeight: bigint;

    /** Block hash */
    readonly blockHash: string;

    /** Block timestamp */
    readonly timestamp: number;

    /** Transactions in the block */
    readonly transactions: readonly ISyncTransactionData[];
}

/**
 * Sync transaction data
 */
export interface ISyncTransactionData {
    /** Transaction ID */
    readonly txid: string;

    /** Transaction hash */
    readonly hash: string;

    /** Raw transaction hex */
    readonly hex: string;

    /** Transaction size in bytes */
    readonly size: number;

    /** OPNet contract interaction data (if any) */
    readonly opnetData?: unknown;
}

/**
 * Sync progress information
 */
export interface ISyncProgress {
    /** Current block being processed */
    readonly currentBlock: bigint;

    /** Target block to sync to */
    readonly targetBlock: bigint;

    /** Percentage complete (0-100) */
    readonly percentage: number;

    /** Estimated time remaining in seconds */
    readonly estimatedTimeRemaining?: number;

    /** Blocks per second processing rate */
    readonly blocksPerSecond?: number;
}

/**
 * Sync options for plugin catch-up
 */
export interface ISyncOptions {
    /** Start block (default: enabledAtBlock) */
    readonly fromBlock?: bigint;

    /** End block (default: current chain tip) */
    readonly toBlock?: bigint;

    /** Batch size for block fetching (default: 100) */
    readonly batchSize?: number;

    /** Whether to emit progress events (default: true) */
    readonly emitProgress?: boolean;

    /** Timeout per block in ms (default: 30000) */
    readonly blockTimeoutMs?: number;
}

/**
 * Plugin sync status
 */
export enum PluginSyncStatus {
    /** Plugin is synced with chain */
    SYNCED = 'synced',

    /** Plugin is behind and needs to catch up */
    BEHIND = 'behind',

    /** Plugin is currently syncing */
    SYNCING = 'syncing',

    /** Plugin sync failed */
    FAILED = 'failed',

    /** Plugin has never synced (first install) */
    NEVER_SYNCED = 'never_synced',
}

/**
 * Result of checking plugin sync status
 */
export interface IPluginSyncCheck {
    /** Current sync status */
    readonly status: PluginSyncStatus;

    /** Last synced block */
    readonly lastSyncedBlock: bigint;

    /** Current chain tip */
    readonly chainTip: bigint;

    /** Number of blocks behind */
    readonly blocksBehind: bigint;

    /** Whether plugin needs to sync before starting */
    readonly requiresSync: boolean;

    /** Reindex check result (if reindex is enabled) */
    readonly reindexCheck?: IReindexCheck;
}

/**
 * Reindex action types
 */
export enum ReindexAction {
    /** No action required - plugin data is compatible with reindex */
    NONE = 'none',

    /** Plugin needs to purge data back to reindex block */
    PURGE = 'purge',

    /** Plugin needs to sync from reindex block */
    SYNC = 'sync',

    /** Plugin needs full reset (purge + sync from genesis/reindex block) */
    RESET = 'reset',
}

/**
 * Result of checking plugin reindex requirements
 */
export interface IReindexCheck {
    /** Whether reindex mode is enabled */
    readonly reindexEnabled: boolean;

    /** Block height reindex is targeting */
    readonly reindexFromBlock: bigint;

    /** Plugin's last synced block */
    readonly pluginLastSyncedBlock: bigint;

    /** Action required for this plugin */
    readonly action: ReindexAction;

    /** Whether plugin data needs to be purged */
    readonly requiresPurge: boolean;

    /** Block height to purge to (if requiresPurge is true) */
    readonly purgeToBlock?: bigint;

    /** Whether plugin needs to sync after reindex */
    readonly requiresSync: boolean;

    /** Block height to sync from (if requiresSync is true) */
    readonly syncFromBlock?: bigint;

    /** Block height to sync to (reindex target) */
    readonly syncToBlock?: bigint;
}
