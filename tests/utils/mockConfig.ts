/**
 * Shared Config mock for unit tests that transitively import Config.
 *
 * Import this as the FIRST import in your test file:
 *
 *   import '../utils/mockConfig.js';
 *
 * vitest hoists vi.mock calls, so the Config module is replaced before
 * any source module tries to load btc.conf from disk.
 */
import { vi } from 'vitest';

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
        DEV_MODE: false,
        DEBUG_LEVEL: 0,
        OP_NET: {
            REINDEX: false,
            REINDEX_FROM_BLOCK: 0,
            REINDEX_BATCH_SIZE: 1000,
            REINDEX_PURGE_UTXOS: true,
            EPOCH_REINDEX: false,
            EPOCH_REINDEX_FROM_EPOCH: 0,
            MAXIMUM_PREFETCH_BLOCKS: 10,
            MODE: 'ARCHIVE',
            LIGHT_MODE_FROM_BLOCK: 0,
        },
        DEV: {
            RESYNC_BLOCK_HEIGHTS: false,
            RESYNC_BLOCK_HEIGHTS_UNTIL: 0,
            ALWAYS_ENABLE_REORG_VERIFICATION: false,
            PROCESS_ONLY_X_BLOCK: 0,
            CAUSE_FETCHING_FAILURE: false,
            ENABLE_REORG_NIGHTMARE: false,
        },
        BITCOIN: {
            NETWORK: 'regtest',
            CHAIN_ID: 0,
        },
        PLUGINS: {
            PLUGINS_ENABLED: false,
        },
        INDEXER: {
            READONLY_MODE: false,
            STORAGE_TYPE: 'MONGODB',
            BLOCK_QUERY_INTERVAL: 100,
            START_INDEXING_UTXO_AT_BLOCK_HEIGHT: 0n,
            SOLVE_UNKNOWN_UTXOS: false,
            DISABLE_UTXO_INDEXING: false,
        },
        BLOCKCHAIN: {},
    },
}));
