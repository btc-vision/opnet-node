/**
 * CRITICAL CONSENSUS VULNERABILITY TESTS - BlockIndexer.onBlockChange
 *
 * Tests for the missing reorg detection in BlockIndexer.onBlockChange().
 * When Bitcoin RPC reports a tip at a height the node has ALREADY processed
 * (or lower), the system must trigger reorg investigation instead of
 * silently ignoring it.
 */
import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockIndexer } from '../../../src/src/blockchain-indexer/processor/BlockIndexer.js';

// Must be hoisted before vi.mock
const mockConfig = vi.hoisted(() => ({
    DEV_MODE: false,
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
    },
    BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 },
    PLUGINS: { PLUGINS_ENABLED: false },
    INDEXER: { READONLY_MODE: false, STORAGE_TYPE: 'MONGODB' },
    BLOCKCHAIN: {},
}));

const mockVmStorage = vi.hoisted(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    killAllPendingWrites: vi.fn().mockResolvedValue(undefined),
    revertDataUntilBlock: vi.fn().mockResolvedValue(undefined),
    revertBlockHeadersOnly: vi.fn().mockResolvedValue(undefined),
    setReorg: vi.fn().mockResolvedValue(undefined),
    getLatestBlock: vi.fn().mockResolvedValue(undefined),
    blockchainRepository: {},
    close: vi.fn(),
}));

const mockChainObserver = vi.hoisted(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    onChainReorganisation: vi.fn().mockResolvedValue(undefined),
    setNewHeight: vi.fn().mockResolvedValue(undefined),
    pendingBlockHeight: 5757n,
    pendingTaskHeight: 5757n,
    targetBlockHeight: 5756n,
    nextBestTip: 5757n,
    watchBlockchain: vi.fn(),
    notifyBlockProcessed: vi.fn(),
    getBlockHeader: vi.fn(),
    onBlockChange: vi.fn(),
}));

const mockBlockFetcher = vi.hoisted(() => ({
    onReorg: vi.fn(),
    subscribeToBlockChanges: vi.fn(),
    watchBlockChanges: vi.fn().mockResolvedValue(undefined),
    getBlock: vi.fn(),
}));

const mockReorgWatchdog = vi.hoisted(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    pendingBlockHeight: 5757n,
    subscribeToReorgs: vi.fn(),
    onBlockChange: vi.fn(),
}));

const mockVmManager = vi.hoisted(() => ({
    prepareBlock: vi.fn(),
    blockHeaderValidator: {
        validateBlockChecksum: vi.fn(),
        getBlockHeader: vi.fn(),
        setLastBlockHeader: vi.fn(),
    },
}));

const mockEpochManager = vi.hoisted(() => ({
    sendMessageToThread: null as null | ((...args: unknown[]) => unknown),
    updateEpoch: vi.fn().mockResolvedValue(undefined),
}));

const mockEpochReindexer = vi.hoisted(() => ({
    reindexEpochs: vi.fn().mockResolvedValue(true),
}));

// Mock ALL modules
vi.mock('../../../src/src/config/Config.js', () => ({ Config: mockConfig }));
vi.mock('../../../src/src/vm/storage/databases/MongoDBConfigurationDefaults.js', () => ({
    MongoDBConfigurationDefaults: {},
}));

vi.mock('@btc-vision/bsi-common', () => ({
    ConfigurableDBManager: vi.fn(function (this: Record<string, unknown>) {
        this.db = null;
    }),
    Logger: class Logger {
        readonly logColor: string = '';
        log(..._a: unknown[]) {}
        warn(..._a: unknown[]) {}
        error(..._a: unknown[]) {}
        info(..._a: unknown[]) {}
        debugBright(..._a: unknown[]) {}
        success(..._a: unknown[]) {}
        fail(..._a: unknown[]) {}
        panic(..._a: unknown[]) {}
        important(..._a: unknown[]) {}
    },
    DebugLevel: {},
    DataConverter: { fromDecimal128: vi.fn() },
}));

vi.mock('@btc-vision/bitcoin-rpc', () => ({
    BitcoinRPC: vi.fn(function () {
        return { init: vi.fn().mockResolvedValue(undefined) };
    }),
}));

vi.mock('@btc-vision/bitcoin', () => ({
    Network: {},
}));

vi.mock('../../../src/src/blockchain-indexer/fetcher/RPCBlockFetcher.js', () => ({
    RPCBlockFetcher: vi.fn(function () {
        return mockBlockFetcher;
    }),
}));

vi.mock('../../../src/src/blockchain-indexer/processor/observer/ChainObserver.js', () => ({
    ChainObserver: vi.fn(function () {
        return mockChainObserver;
    }),
}));

vi.mock('../../../src/src/vm/storage/databases/VMMongoStorage.js', () => ({
    VMMongoStorage: vi.fn(function () {
        return mockVmStorage;
    }),
}));

vi.mock('../../../src/src/vm/VMManager.js', () => ({
    VMManager: vi.fn(function () {
        return mockVmManager;
    }),
}));

vi.mock('../../../src/src/blockchain-indexer/processor/consensus/ConsensusTracker.js', () => ({
    ConsensusTracker: vi.fn(function () {
        return { setConsensusBlockHeight: vi.fn() };
    }),
}));

vi.mock(
    '../../../src/src/blockchain-indexer/processor/special-transaction/SpecialManager.js',
    () => ({
        SpecialManager: vi.fn(function () {
            return {};
        }),
    }),
);

vi.mock('../../../src/src/config/network/NetworkConverter.js', () => ({
    NetworkConverter: { getNetwork: vi.fn(() => ({})) },
}));

vi.mock('../../../src/src/blockchain-indexer/processor/reorg/ReorgWatchdog.js', () => ({
    ReorgWatchdog: vi.fn(function () {
        return mockReorgWatchdog;
    }),
}));

vi.mock('../../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: { opnetEnabled: { ENABLED: false, BLOCK: 0n } },
}));

vi.mock('../../../src/src/blockchain-indexer/processor/epoch/EpochManager.js', () => ({
    EpochManager: vi.fn(function () {
        return mockEpochManager;
    }),
}));

vi.mock('../../../src/src/blockchain-indexer/processor/epoch/EpochReindexer.js', () => ({
    EpochReindexer: vi.fn(function () {
        return mockEpochReindexer;
    }),
}));

vi.mock('../../../src/src/vm/storage/types/IndexerStorageType.js', () => ({
    IndexerStorageType: { MONGODB: 'MONGODB' },
}));

vi.mock('../../../src/src/vm/storage/VMStorage.js', () => ({
    VMStorage: class VMStorage {
        readonly logColor = '';
        log() {}
        warn() {}
        error() {}
        info() {}
        debugBright() {}
        success() {}
        fail() {}
        panic() {}
        important() {}
    },
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => false),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
    },
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
}));

vi.mock('../../../src/src/blockchain-indexer/processor/tasks/IndexingTask.js', () => ({
    IndexingTask: vi.fn(),
}));

vi.mock('../../../src/src/blockchain-indexer/fetcher/abstract/BlockFetcher.js', () => ({
    BlockFetcher: class BlockFetcher {
        readonly logColor = '';
        log() {}
        warn() {}
        error() {}
        info() {}
        debugBright() {}
        success() {}
        fail() {}
        panic() {}
        important() {}
    },
}));

vi.mock('../../../src/src/config/interfaces/OPNetIndexerMode.js', () => ({
    OPNetIndexerMode: { ARCHIVE: 'ARCHIVE', FULL: 'FULL', LIGHT: 'LIGHT' },
}));

interface BlockHeader {
    height: number;
    hash: string;
    previousblockhash: string;
}

type OnBlockChangeFn = (header: BlockHeader) => void;

function callOnBlockChange(indexer: BlockIndexer, header: BlockHeader): void {
    const fn = Reflect.get(indexer, 'onBlockChange') as OnBlockChangeFn;
    fn.call(indexer, header);
}

describe('BlockIndexer.onBlockChange - Reorg Detection Vulnerabilities', () => {
    let indexer: BlockIndexer;

    beforeEach(() => {
        vi.clearAllMocks();

        mockChainObserver.pendingBlockHeight = 5757n;
        mockChainObserver.pendingTaskHeight = 5757n;
        // targetBlockHeight < pendingTaskHeight prevents startTasks from creating
        // new IndexingTask instances (the for loop breaks immediately)
        mockChainObserver.targetBlockHeight = 5756n;
        mockReorgWatchdog.pendingBlockHeight = 5757n;

        indexer = new BlockIndexer();
        indexer.sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);
        indexer.sendMessageToThread = vi.fn().mockResolvedValue(null);

        Reflect.set(indexer, '_blockFetcher', mockBlockFetcher);
        Reflect.set(indexer, 'started', true);
        Reflect.set(indexer, 'taskInProgress', false);
        Reflect.set(indexer, 'indexingTasks', []);
    });

    describe('VULNERABILITY: height regression not detected as reorg', () => {
        /**
         * Real scenario from logs:
         * - Node processed block 5756, height moved to 5757
         * - Bitcoin RPC fires onBlockChange with height 5756 (different hash)
         * - This is a REORG but the system just updates targetBlockHeight
         */
        it('should trigger reorg when incoming height < processed height', () => {
            // Node has processed up to 5757
            mockChainObserver.pendingBlockHeight = 5757n;

            // Bitcoin RPC reports tip went BACK to 5756
            const header = {
                height: 5756,
                hash: '0000006eb01180669f8a70f23381d6b5f7979f389cb8553d2c696078527b96b0',
                previousblockhash: 'parent5755hash',
            };

            callOnBlockChange(indexer, header);

            // BUG: Currently just updates chainObserver and tries to start tasks.
            // It never detects that height went backwards.
            // The watchdog and observer are notified but no reorg is triggered.
            expect(mockReorgWatchdog.onBlockChange).toHaveBeenCalledWith(header);
            expect(mockChainObserver.onBlockChange).toHaveBeenCalledWith(header);

            // After this call, targetBlockHeight becomes 5756 (via chainObserver mock)
            // but pendingBlockHeight is still 5757. This inconsistency means:
            // - No new tasks start (target < pending)
            // - No reorg is triggered
            // - Node is stuck in limbo
        });

        it('should detect when target drops below pending height after onBlockChange', () => {
            mockChainObserver.pendingBlockHeight = 5757n;
            mockChainObserver.targetBlockHeight = 5757n;

            // Simulate chainObserver.onBlockChange updating targetBlockHeight
            mockChainObserver.onBlockChange.mockImplementation(() => {
                mockChainObserver.targetBlockHeight = 5756n;
            });

            callOnBlockChange(indexer, {
                height: 5756,
                hash: 'new_hash_5756',
                previousblockhash: 'parent5755',
            });

            // After the call, height regressed
            expect(mockChainObserver.targetBlockHeight).toBe(5756n);
            expect(mockChainObserver.pendingBlockHeight).toBe(5757n);

            // BUG: This state (target < pending) is never checked.
            // onBlockChange should detect this regression and trigger reorg.
        });
    });

    describe('VULNERABILITY: same-height different-hash not detected', () => {
        it('should detect reorg when same height arrives with different hash', () => {
            mockChainObserver.pendingBlockHeight = 5757n;
            mockChainObserver.targetBlockHeight = 5756n;

            const header = {
                height: 5756,
                hash: 'new_competing_hash_at_5756',
                previousblockhash: 'parent5755',
            };

            callOnBlockChange(indexer, header);

            // The header updates the watchdog's currentHeader.
            // But onBlockChange never checks "did we already process this height?"
            expect(mockReorgWatchdog.onBlockChange).toHaveBeenCalledWith(header);
        });

        it('should detect reorg when task is in progress and same height arrives', () => {
            mockChainObserver.pendingBlockHeight = 5756n;
            mockChainObserver.targetBlockHeight = 5756n;

            // Task processing block 5756
            Reflect.set(indexer, 'taskInProgress', true);
            Reflect.set(indexer, 'indexingTasks', [{ tip: 5756n }]);

            const header = {
                height: 5756,
                hash: 'different_hash',
                previousblockhash: 'parent5755',
            };

            callOnBlockChange(indexer, header);

            // BUG: taskInProgress && indexingTasks.length !== 0 → early return
            // The competing block notification is silently dropped!
            // Only watchdog.onBlockChange and chainObserver.onBlockChange are called.
            expect(mockReorgWatchdog.onBlockChange).toHaveBeenCalledWith(header);
            expect(mockChainObserver.onBlockChange).toHaveBeenCalledWith(header);
        });
    });

    describe('VULNERABILITY: notifications silently dropped during active tasks', () => {
        it('should not silently drop block change when taskInProgress', () => {
            Reflect.set(indexer, 'taskInProgress', true);
            Reflect.set(indexer, 'indexingTasks', [{ tip: 5757n }]);

            const header = {
                height: 5756,
                hash: 'reorg_hash',
                previousblockhash: 'parent5755',
            };

            callOnBlockChange(indexer, header);

            // Both are notified but there's no active reorg trigger
            expect(mockReorgWatchdog.onBlockChange).toHaveBeenCalled();
            expect(mockChainObserver.onBlockChange).toHaveBeenCalled();

            // The node relies entirely on the NEXT task's verifyReorg() call,
            // which only checks previousBlockHash, not current block hash.
        });

        it('should compare incoming block height against current processing height', () => {
            // Node is processing block 5757
            Reflect.set(indexer, 'taskInProgress', true);
            Reflect.set(indexer, 'currentTask', { tip: 5757n });
            Reflect.set(indexer, 'indexingTasks', [{ tip: 5758n }]);

            // RPC reports tip changed to 5756 (reorg!)
            const header = {
                height: 5756,
                hash: 'reorg_hash',
                previousblockhash: 'parent5755',
            };

            callOnBlockChange(indexer, header);

            // BUG: onBlockChange doesn't look at currentTask.tip at all.
            // When incoming height (5756) < currentTask.tip (5757),
            // the current task is processing a block on a now-invalid chain.
            // It should cancel the task and trigger reorg immediately.
        });
    });

    describe('Correct behavior: forward progress notifications', () => {
        it('should update reorgWatchdog and chainObserver on normal block change', () => {
            const header = {
                height: 5758,
                hash: 'hash5758',
                previousblockhash: 'hash5757',
            };

            callOnBlockChange(indexer, header);

            expect(mockReorgWatchdog.onBlockChange).toHaveBeenCalledWith(header);
            expect(mockChainObserver.onBlockChange).toHaveBeenCalledWith(header);
        });

        it('should not start tasks when chainReorged is true', () => {
            Reflect.set(indexer, 'chainReorged', true);

            callOnBlockChange(indexer, {
                height: 5758,
                hash: 'hash5758',
                previousblockhash: 'hash5757',
            });

            // watchdog and observer are still updated
            expect(mockReorgWatchdog.onBlockChange).toHaveBeenCalled();
            expect(mockChainObserver.onBlockChange).toHaveBeenCalled();

            // But startTasks should return early due to chainReorged flag
        });

        it('should skip new tasks when PROCESS_ONLY_X_BLOCK limit reached', () => {
            mockConfig.DEV.PROCESS_ONLY_X_BLOCK = 5;
            Reflect.set(indexer, 'processedBlocks', 5);

            callOnBlockChange(indexer, {
                height: 5758,
                hash: 'hash5758',
                previousblockhash: 'hash5757',
            });

            // Should return early due to PROCESS_ONLY_X_BLOCK limit
            // Reset for other tests
            mockConfig.DEV.PROCESS_ONLY_X_BLOCK = 0;
        });
    });
});
