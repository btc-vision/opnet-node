export interface MockConfigOverrides {
    DEV_MODE?: boolean;
    REINDEX_BATCH_SIZE?: number;
    REINDEX_PURGE_UTXOS?: boolean;
    REINDEX?: boolean;
    REINDEX_FROM_BLOCK?: number;
    EPOCH_REINDEX?: boolean;
    EPOCH_REINDEX_FROM_EPOCH?: number;
    RESYNC_BLOCK_HEIGHTS?: boolean;
    RESYNC_BLOCK_HEIGHTS_UNTIL?: number;
    ALWAYS_ENABLE_REORG_VERIFICATION?: boolean;
    PLUGINS_ENABLED?: boolean;
    NETWORK?: string;
    READONLY_MODE?: boolean;
    PROCESS_ONLY_X_BLOCK?: number;
}

export function createMockConfig(overrides: MockConfigOverrides = {}) {
    return {
        DEV_MODE: overrides.DEV_MODE ?? false,
        OP_NET: {
            REINDEX_BATCH_SIZE: overrides.REINDEX_BATCH_SIZE ?? 1000,
            REINDEX_PURGE_UTXOS: overrides.REINDEX_PURGE_UTXOS ?? true,
            REINDEX: overrides.REINDEX ?? false,
            REINDEX_FROM_BLOCK: overrides.REINDEX_FROM_BLOCK ?? 0,
            EPOCH_REINDEX: overrides.EPOCH_REINDEX ?? false,
            EPOCH_REINDEX_FROM_EPOCH: overrides.EPOCH_REINDEX_FROM_EPOCH ?? 0,
            MAXIMUM_PREFETCH_BLOCKS: 10,
            TRANSACTIONS_MAXIMUM_CONCURRENT: 10,
            PENDING_BLOCK_THRESHOLD: 10,
            ENABLE_BATCH_PROCESSING: true,
            DISABLE_SCANNED_BLOCK_STORAGE_CHECK: false,
            VERIFY_INTEGRITY_ON_STARTUP: false,
            MODE: 'ARCHIVE',
            LIGHT_MODE_FROM_BLOCK: 0,
        },
        DEV: {
            RESYNC_BLOCK_HEIGHTS: overrides.RESYNC_BLOCK_HEIGHTS ?? false,
            RESYNC_BLOCK_HEIGHTS_UNTIL: overrides.RESYNC_BLOCK_HEIGHTS_UNTIL ?? 0,
            ALWAYS_ENABLE_REORG_VERIFICATION: overrides.ALWAYS_ENABLE_REORG_VERIFICATION ?? false,
            PROCESS_ONLY_X_BLOCK: overrides.PROCESS_ONLY_X_BLOCK ?? 0,
            DEBUG_TRANSACTION_FAILURE: false,
            ALLOW_LARGE_TRANSACTIONS: false,
            DEBUG_TRANSACTION_PARSE_FAILURE: false,
            CAUSE_FETCHING_FAILURE: false,
            DISPLAY_VALID_BLOCK_WITNESS: false,
            DISPLAY_INVALID_BLOCK_WITNESS: false,
            SAVE_TIMEOUTS_TO_FILE: false,
            SIMULATE_HIGH_GAS_USAGE: false,
            DEBUG_VALID_TRANSACTIONS: false,
            DEBUG_API_ERRORS: false,
            DEBUG_PENDING_REQUESTS: false,
            DEBUG_API_CALLS: false,
            ENABLE_CONTRACT_DEBUG: false,
            ENABLE_REORG_NIGHTMARE: false,
        },
        BITCOIN: {
            NETWORK: overrides.NETWORK ?? 'regtest',
            CHAIN_ID: 0,
        },
        PLUGINS: {
            PLUGINS_ENABLED: overrides.PLUGINS_ENABLED ?? false,
            PLUGINS_DIR: '',
            WORKER_POOL_SIZE: 1,
            EMIT_ERROR_OR_WARNING: false,
        },
        INDEXER: {
            READONLY_MODE: overrides.READONLY_MODE ?? false,
            ENABLED: true,
            BLOCK_UPDATE_METHOD: 'RPC',
            ALLOW_PURGE: true,
            BLOCK_QUERY_INTERVAL: 1000,
            SOLVE_UNKNOWN_UTXOS: false,
            STORAGE_TYPE: 'MONGODB',
            PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS: 100,
            UTXO_SAVE_INTERVAL: 100,
            START_INDEXING_UTXO_AT_BLOCK_HEIGHT: 0,
        },
        BLOCKCHAIN: {
            BITCOIND_HOST: 'localhost',
            BITCOIND_PORT: 8332,
            BITCOIND_USERNAME: 'user',
            BITCOIND_PASSWORD: 'pass',
        },
    };
}
