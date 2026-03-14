/**
 * Tests for BlockIndexer.onHeightRegressionDetected, the full revert flow.
 *
 * Verifies that when onBlockChange detects a height regression,
 * it calls revertChain with the correct arguments, then restarts
 * the task pipeline via startTasks.
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

describe('BlockIndexer - Height Regression Revert Flow', () => {
    let indexer: BlockIndexer;

    beforeEach(() => {
        vi.clearAllMocks();

        mockChainObserver.pendingBlockHeight = 5757n;
        mockChainObserver.pendingTaskHeight = 5758n;
        mockChainObserver.targetBlockHeight = 5756n;
        mockReorgWatchdog.pendingBlockHeight = 5757n;
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

    describe('revertChain is called with correct arguments', () => {
        it('should call revertChain(incomingHeight, pendingHeight, hash, true) on same-height reorg', async () => {
            mockChainObserver.pendingBlockHeight = 5756n;

            const revertSpy = vi.spyOn(indexer as never, 'revertChain');

            callOnBlockChange(indexer, {
                height: 5756,
                hash: 'new_hash_5756',
                previousblockhash: 'parent5755',
            });

            // Allow the async onHeightRegressionDetected to execute
            await vi.waitFor(() => {
                expect(revertSpy).toHaveBeenCalled();
            });

            expect(revertSpy).toHaveBeenCalledWith(5756n, 5756n, 'new_hash_5756', true);
        });

        it('should call revertChain(incomingHeight, pendingHeight, hash, true) on height drop', async () => {
            mockChainObserver.pendingBlockHeight = 5757n;

            const revertSpy = vi.spyOn(indexer as never, 'revertChain');

            callOnBlockChange(indexer, {
                height: 5755,
                hash: 'hash_5755',
                previousblockhash: 'parent5754',
            });

            await vi.waitFor(() => {
                expect(revertSpy).toHaveBeenCalled();
            });

            // fromHeight=5755 (revert from here), toHeight=5757 (how far we had processed)
            expect(revertSpy).toHaveBeenCalledWith(5755n, 5757n, 'hash_5755', true);
        });

});

    describe('revertChain triggers the full revert pipeline', () => {
        it('should purge data via revertDataUntilBlock with the incoming height', async () => {
            mockChainObserver.pendingBlockHeight = 100n;

            callOnBlockChange(indexer, {
                height: 98,
                hash: 'reorg_hash',
                previousblockhash: 'prev97',
            });

            await vi.waitFor(() => {
                expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalled();
            });

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(98n, true);
        });

        it('should call onChainReorganisation with correct heights', async () => {
            mockChainObserver.pendingBlockHeight = 100n;

            callOnBlockChange(indexer, {
                height: 95,
                hash: 'reorg_hash',
                previousblockhash: 'prev94',
            });

            await vi.waitFor(() => {
                expect(mockChainObserver.onChainReorganisation).toHaveBeenCalled();
            });

            expect(mockChainObserver.onChainReorganisation).toHaveBeenCalledWith(
                95n,
                100n,
                'reorg_hash',
            );
        });

        it('should record the reorg via setReorg', async () => {
            mockChainObserver.pendingBlockHeight = 100n;

            callOnBlockChange(indexer, {
                height: 98,
                hash: 'reorg_hash',
                previousblockhash: 'prev97',
            });

            await vi.waitFor(() => {
                expect(mockVmStorage.setReorg).toHaveBeenCalled();
            });

            expect(mockVmStorage.setReorg).toHaveBeenCalledWith(
                expect.objectContaining({
                    fromBlock: 98n,
                    toBlock: 100n,
                    timestamp: expect.any(Date) as Date,
                }),
            );
        });

        it('should stop in-progress tasks before reverting', async () => {
            const task = { cancel: vi.fn().mockResolvedValue(undefined) };
            Reflect.set(indexer, 'currentTask', task);
            Reflect.set(indexer, 'taskInProgress', true);
            mockChainObserver.pendingBlockHeight = 100n;

            callOnBlockChange(indexer, {
                height: 99,
                hash: 'reorg_hash',
                previousblockhash: 'prev98',
            });

            await vi.waitFor(() => {
                expect(task.cancel).toHaveBeenCalled();
            });

            expect(task.cancel).toHaveBeenCalledWith(true);
        });

        it('should clean block fetcher cache during revert', async () => {
            mockChainObserver.pendingBlockHeight = 100n;

            callOnBlockChange(indexer, {
                height: 99,
                hash: 'reorg_hash',
                previousblockhash: 'prev98',
            });

            await vi.waitFor(() => {
                expect(mockBlockFetcher.onReorg).toHaveBeenCalled();
            });
        });
    });

    describe('chainReorged flag prevents concurrent reverts', () => {
        it('should not trigger a second revert while first is in progress', async () => {
            mockChainObserver.pendingBlockHeight = 100n;

            // Make revertChain slow so we can fire a second onBlockChange during it
            let resolveRevert: (() => void) | undefined;
            mockVmStorage.revertDataUntilBlock.mockImplementation(() => {
                return new Promise<void>((resolve) => {
                    resolveRevert = resolve;
                });
            });

            const revertSpy = vi.spyOn(indexer as never, 'onHeightRegressionDetected');

            // First regression
            callOnBlockChange(indexer, {
                height: 99,
                hash: 'reorg1',
                previousblockhash: 'prev98',
            });

            // Wait for revert to start (chainReorged = true)
            await vi.waitFor(() => {
                expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalled();
            });

            // Second regression while first is in-flight
            callOnBlockChange(indexer, {
                height: 98,
                hash: 'reorg2',
                previousblockhash: 'prev97',
            });

            // onHeightRegressionDetected should only have been called ONCE
            // because chainReorged=true blocks the second call
            expect(revertSpy).toHaveBeenCalledTimes(1);

            // Complete the first revert
            resolveRevert?.();
        });
    });

    describe('exact log scenario: block 5756 processed, tip drops back to 5756', () => {
        it('should trigger revertChain matching the production log scenario', async () => {
            mockChainObserver.pendingBlockHeight = 5756n;

            const revertSpy = vi.spyOn(indexer as never, 'revertChain');

            callOnBlockChange(indexer, {
                height: 5756,
                hash: '0000006eb01180669f8a70f23381d6b5f7979f389cb8553d2c696078527b96b0',
                previousblockhash: 'parent5755hash',
            });

            await vi.waitFor(() => {
                expect(revertSpy).toHaveBeenCalled();
            });

            expect(revertSpy).toHaveBeenCalledWith(
                5756n,
                5756n,
                '0000006eb01180669f8a70f23381d6b5f7979f389cb8553d2c696078527b96b0',
                true,
            );
        });

        it('should purge block 5756 data and notify chain observer', async () => {
            mockChainObserver.pendingBlockHeight = 5756n;

            callOnBlockChange(indexer, {
                height: 5756,
                hash: '0000006eb01180669f8a70f23381d6b5f7979f389cb8553d2c696078527b96b0',
                previousblockhash: 'parent5755hash',
            });

            await vi.waitFor(() => {
                expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalled();
            });

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(5756n, true);
        });
    });
});
