/**
 * Edge case tests for BlockIndexer.onBlockChange height regression detection.
 *
 * Tests cover:
 * - Guard conditions (started, chainReorged, incomingHeight > 0)
 * - PROCESS_ONLY_X_BLOCK runs before regression detection
 * - Same-height (<=) boundary vs strict-less-than (<)
 * - revertChain parameter correctness
 * - Interaction with taskInProgress
 * - pendingBlockHeight at 0n edge case
 */
import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockIndexer } from '../../../src/src/blockchain-indexer/processor/BlockIndexer.js';

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
    pendingBlockHeight: 100n,
    pendingTaskHeight: 101n,
    targetBlockHeight: 99n,
    nextBestTip: 100n,
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
    pendingBlockHeight: 100n,
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
vi.mock('@btc-vision/bitcoin', () => ({ Network: {} }));
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
    default: { existsSync: vi.fn(() => false), writeFileSync: vi.fn(), appendFileSync: vi.fn() },
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

describe('BlockIndexer.onBlockChange - Height Regression Edge Cases', () => {
    let indexer: BlockIndexer;

    beforeEach(() => {
        vi.clearAllMocks();

        mockChainObserver.pendingBlockHeight = 100n;
        mockChainObserver.pendingTaskHeight = 101n;
        mockChainObserver.targetBlockHeight = 99n;
        mockReorgWatchdog.pendingBlockHeight = 100n;
        mockConfig.DEV.PROCESS_ONLY_X_BLOCK = 0;

        indexer = new BlockIndexer();
        indexer.sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);
        indexer.sendMessageToThread = vi.fn().mockResolvedValue(null);

        Reflect.set(indexer, '_blockFetcher', mockBlockFetcher);
        Reflect.set(indexer, 'started', true);
        Reflect.set(indexer, 'taskInProgress', false);
        Reflect.set(indexer, 'indexingTasks', []);
        Reflect.set(indexer, 'chainReorged', false);
    });

    describe('guard: started must be true', () => {
        it('should NOT trigger regression when started is false', () => {
            Reflect.set(indexer, 'started', false);
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 50,
                hash: 'hash50',
                previousblockhash: 'prev49',
            });

            expect(revertSpy).not.toHaveBeenCalled();
        });
    });

    describe('guard: chainReorged must be false', () => {
        it('should NOT trigger regression when chainReorged is true', () => {
            Reflect.set(indexer, 'chainReorged', true);
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 50,
                hash: 'hash50',
                previousblockhash: 'prev49',
            });

            expect(revertSpy).not.toHaveBeenCalled();
        });
    });

    describe('guard: incomingHeight must be > 0', () => {
        it('should NOT trigger regression for height 0 (genesis)', () => {
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 0,
                hash: 'genesis_hash',
                previousblockhash: '',
            });

            expect(revertSpy).not.toHaveBeenCalled();
        });
    });

    describe('PROCESS_ONLY_X_BLOCK takes priority over regression', () => {
        it('should return early when block limit reached, even if height regressed', () => {
            mockConfig.DEV.PROCESS_ONLY_X_BLOCK = 5;
            Reflect.set(indexer, 'processedBlocks', 5);
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 50,
                hash: 'hash50',
                previousblockhash: 'prev49',
            });

            expect(revertSpy).not.toHaveBeenCalled();
        });

        it('should allow regression detection when block limit NOT reached', () => {
            mockConfig.DEV.PROCESS_ONLY_X_BLOCK = 10;
            Reflect.set(indexer, 'processedBlocks', 5);
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 50,
                hash: 'hash50',
                previousblockhash: 'prev49',
            });

            expect(revertSpy).toHaveBeenCalledWith(50n, 'hash50');
        });
    });

    describe('boundary: <= vs < comparison', () => {
        it('should trigger regression for same height (== pendingBlockHeight)', () => {
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 100,
                hash: 'new_hash_100',
                previousblockhash: 'prev99',
            });

            // Same height with changed hash = same-height reorg
            expect(revertSpy).toHaveBeenCalledWith(100n, 'new_hash_100');
        });

        it('should trigger regression for strictly lower height', () => {
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 99,
                hash: 'hash99',
                previousblockhash: 'prev98',
            });

            expect(revertSpy).toHaveBeenCalledWith(99n, 'hash99');
        });

        it('should NOT trigger regression for height above pendingBlockHeight', () => {
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 101,
                hash: 'hash101',
                previousblockhash: 'prev100',
            });

            expect(revertSpy).not.toHaveBeenCalled();
        });
    });

    describe('onHeightRegressionDetected parameters', () => {
        it('should pass incomingHeight and hash to onHeightRegressionDetected', () => {
            mockChainObserver.pendingBlockHeight = 5757n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 5756,
                hash: '0000006eb01180669f8a70f23381d6b5f7979f389cb8553d2c696078527b96b0',
                previousblockhash: 'parent5755',
            });

            expect(revertSpy).toHaveBeenCalledWith(
                5756n,
                '0000006eb01180669f8a70f23381d6b5f7979f389cb8553d2c696078527b96b0',
            );
        });
    });

    describe('regression with active task', () => {
        it('should trigger regression even when taskInProgress is true', () => {
            Reflect.set(indexer, 'taskInProgress', true);
            Reflect.set(indexer, 'indexingTasks', [{ tip: 101n }]);
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 99,
                hash: 'reorg_hash',
                previousblockhash: 'prev98',
            });

            // Regression detection runs BEFORE the taskInProgress early return
            expect(revertSpy).toHaveBeenCalledWith(99n, 'reorg_hash');
        });
    });

    describe('regression does not fire for initial sync heights', () => {
        it('should NOT trigger regression when node is far behind tip', () => {
            mockChainObserver.pendingBlockHeight = 100n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            // RPC tip at 5000, far above pendingBlockHeight
            callOnBlockChange(indexer, {
                height: 5000,
                hash: 'tip_hash',
                previousblockhash: 'prev4999',
            });

            expect(revertSpy).not.toHaveBeenCalled();
        });

        it('should NOT trigger regression when pendingBlockHeight is 0 and incoming is 1', () => {
            mockChainObserver.pendingBlockHeight = 0n;

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            callOnBlockChange(indexer, {
                height: 1,
                hash: 'hash1',
                previousblockhash: 'genesis',
            });

            expect(revertSpy).not.toHaveBeenCalled();
        });
    });

    describe('watchdog and observer always updated regardless of regression', () => {
        it('should update watchdog and observer BEFORE regression check', () => {
            mockChainObserver.pendingBlockHeight = 100n;
            const header = {
                height: 50,
                hash: 'reorg_hash',
                previousblockhash: 'prev49',
            };

            callOnBlockChange(indexer, header);

            // Both should be called even when regression is detected
            expect(mockReorgWatchdog.onBlockChange).toHaveBeenCalledWith(header);
            expect(mockChainObserver.onBlockChange).toHaveBeenCalledWith(header);
        });
    });
});
