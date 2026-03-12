import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadTypes } from '../../../src/src/threading/thread/enums/ThreadTypes.js';
import { MessageType } from '../../../src/src/threading/enum/MessageType.js';
// Now import the REAL BlockIndexer
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
    pendingBlockHeight: 100n,
    pendingTaskHeight: 100n,
    targetBlockHeight: 1000n,
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

const mockOPNetConsensus = vi.hoisted(() => ({
    opnetEnabled: { ENABLED: false, BLOCK: 0n },
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
    OPNetConsensus: mockOPNetConsensus,
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

describe('startupPurge - BlockIndexer.init() (real class)', () => {
    let indexer: BlockIndexer;

    /**
     * Helper to reset mockConfig to default values before each test.
     */
    function resetConfig(): void {
        mockConfig.DEV_MODE = false;
        mockConfig.OP_NET.REINDEX = false;
        mockConfig.OP_NET.REINDEX_FROM_BLOCK = 0;
        mockConfig.OP_NET.EPOCH_REINDEX = false;
        mockConfig.OP_NET.EPOCH_REINDEX_FROM_EPOCH = 0;
        mockConfig.OP_NET.MAXIMUM_PREFETCH_BLOCKS = 10;
        mockConfig.OP_NET.MODE = 'ARCHIVE';
        mockConfig.OP_NET.LIGHT_MODE_FROM_BLOCK = 0;
        mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = false;
        mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 0;
        mockConfig.DEV.PROCESS_ONLY_X_BLOCK = 0;
        mockConfig.PLUGINS.PLUGINS_ENABLED = false;
        mockConfig.INDEXER.READONLY_MODE = false;
        mockConfig.INDEXER.STORAGE_TYPE = 'MONGODB';

        mockOPNetConsensus.opnetEnabled = { ENABLED: false, BLOCK: 0n };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        resetConfig();

        // Reset mock defaults
        mockVmStorage.init.mockResolvedValue(undefined);
        mockVmStorage.killAllPendingWrites.mockResolvedValue(undefined);
        mockVmStorage.revertDataUntilBlock.mockResolvedValue(undefined);
        mockVmStorage.revertBlockHeadersOnly.mockResolvedValue(undefined);
        mockVmStorage.setReorg.mockResolvedValue(undefined);
        mockVmStorage.getLatestBlock.mockResolvedValue(undefined);
        mockChainObserver.init.mockResolvedValue(undefined);
        mockChainObserver.onChainReorganisation.mockResolvedValue(undefined);
        mockChainObserver.setNewHeight.mockResolvedValue(undefined);
        mockChainObserver.pendingBlockHeight = 100n;
        mockChainObserver.targetBlockHeight = 1000n;
        mockReorgWatchdog.pendingBlockHeight = 100n;
        mockReorgWatchdog.init.mockResolvedValue(undefined);
        mockEpochReindexer.reindexEpochs.mockResolvedValue(true);

        indexer = new BlockIndexer();
        indexer.sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);
        indexer.sendMessageToThread = vi.fn().mockResolvedValue(null);
    });

    // ========================================================================
    // REINDEX mode
    // ========================================================================
    describe('REINDEX mode', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX = true;
            mockConfig.OP_NET.REINDEX_FROM_BLOCK = 500;
        });

        it('should use REINDEX_FROM_BLOCK as purgeFromBlock when REINDEX is true', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(500n);
        });

        it('should call setNewHeight with REINDEX_FROM_BLOCK', async () => {
            await (indexer as any).init();

            expect(mockChainObserver.setNewHeight).toHaveBeenCalledWith(500n);
        });

        it('should use revertDataUntilBlock (not revertBlockHeadersOnly) in REINDEX mode', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(500n);
            expect(mockVmStorage.revertBlockHeadersOnly).not.toHaveBeenCalled();
        });

        it('should use REINDEX_FROM_BLOCK=0 resulting in purge from block 0', async () => {
            mockConfig.OP_NET.REINDEX_FROM_BLOCK = 0;

            await (indexer as any).init();

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(0n);
        });

        it('should still call killAllPendingWrites via verifyCommitConflicts in REINDEX mode', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.killAllPendingWrites).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // RESYNC mode
    // ========================================================================
    describe('RESYNC mode', () => {
        beforeEach(() => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 50;
            mockVmStorage.getLatestBlock.mockResolvedValue({ height: 100 });
        });

        it('should call revertBlockHeadersOnly (not revertDataUntilBlock) in RESYNC mode', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.revertBlockHeadersOnly).toHaveBeenCalledWith(
                mockChainObserver.pendingBlockHeight,
            );
            expect(mockVmStorage.revertDataUntilBlock).not.toHaveBeenCalled();
        });

        it('should use pendingBlockHeight as purgeFromBlock in RESYNC (non-REINDEX) mode', async () => {
            mockChainObserver.pendingBlockHeight = 75n;

            await (indexer as any).init();

            expect(mockVmStorage.revertBlockHeadersOnly).toHaveBeenCalledWith(75n);
        });

        it('should call setNewHeight with pendingBlockHeight in RESYNC mode', async () => {
            mockChainObserver.pendingBlockHeight = 75n;

            await (indexer as any).init();

            expect(mockChainObserver.setNewHeight).toHaveBeenCalledWith(75n);
        });
    });

    // ========================================================================
    // normal startup (no REINDEX, no RESYNC)
    // ========================================================================
    describe('normal startup', () => {
        it('should use pendingBlockHeight as purgeFromBlock in normal mode', async () => {
            mockChainObserver.pendingBlockHeight = 200n;

            await (indexer as any).init();

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(200n);
        });

        it('should call revertDataUntilBlock (not revertBlockHeadersOnly) in normal mode', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalled();
            expect(mockVmStorage.revertBlockHeadersOnly).not.toHaveBeenCalled();
        });

        it('should call setNewHeight with pendingBlockHeight in normal mode', async () => {
            mockChainObserver.pendingBlockHeight = 200n;

            await (indexer as any).init();

            expect(mockChainObserver.setNewHeight).toHaveBeenCalledWith(200n);
        });
    });

    // ========================================================================
    // EPOCH_REINDEX mode
    // ========================================================================
    describe('EPOCH_REINDEX mode', () => {
        it('should call epochReindexer.reindexEpochs when EPOCH_REINDEX is true', async () => {
            mockConfig.OP_NET.EPOCH_REINDEX = true;

            await (indexer as any).init();

            expect(mockEpochReindexer.reindexEpochs).toHaveBeenCalled();
        });

        it('should throw when both EPOCH_REINDEX and REINDEX are true', async () => {
            mockConfig.OP_NET.EPOCH_REINDEX = true;
            mockConfig.OP_NET.REINDEX = true;

            await expect((indexer as any).init()).rejects.toThrow(
                'Cannot use EPOCH_REINDEX and REINDEX at the same time',
            );
        });

        it('should pass fromEpoch and pendingBlockHeight to reindexEpochs', async () => {
            mockConfig.OP_NET.EPOCH_REINDEX = true;
            mockConfig.OP_NET.EPOCH_REINDEX_FROM_EPOCH = 5;
            mockChainObserver.pendingBlockHeight = 500n;

            await (indexer as any).init();

            expect(mockEpochReindexer.reindexEpochs).toHaveBeenCalledWith(5n, 500n);
        });

        it('should throw when epoch reindex fails', async () => {
            mockConfig.OP_NET.EPOCH_REINDEX = true;
            mockEpochReindexer.reindexEpochs.mockResolvedValue(false);

            await expect((indexer as any).init()).rejects.toThrow(
                'Epoch reindex failed or was aborted',
            );
        });

        it('should continue to purge step after successful epoch reindex', async () => {
            mockConfig.OP_NET.EPOCH_REINDEX = true;
            mockEpochReindexer.reindexEpochs.mockResolvedValue(true);

            await (indexer as any).init();

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalled();
            expect(mockChainObserver.setNewHeight).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // RESYNC validation
    // ========================================================================
    describe('RESYNC validation', () => {
        it('should throw when OPNet enabled from block 0 and RESYNC requested', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 50;
            mockOPNetConsensus.opnetEnabled = { ENABLED: true, BLOCK: 0n };

            await expect((indexer as any).init()).rejects.toThrow(
                'RESYNC_BLOCK_HEIGHTS cannot be used on this network',
            );
        });

        it('should throw when RESYNC_BLOCK_HEIGHTS_UNTIL >= OPNet activation block', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 1000;
            mockOPNetConsensus.opnetEnabled = { ENABLED: true, BLOCK: 500n };

            await expect((indexer as any).init()).rejects.toThrow(
                'RESYNC_BLOCK_HEIGHTS_UNTIL (1000) must be less than OPNet activation block (500)',
            );
        });

        it('should allow RESYNC when RESYNC_BLOCK_HEIGHTS_UNTIL < OPNet activation block', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 499;
            mockOPNetConsensus.opnetEnabled = { ENABLED: true, BLOCK: 500n };
            mockVmStorage.getLatestBlock.mockResolvedValue({ height: 600 });

            await expect((indexer as any).init()).resolves.toBeUndefined();
        });

        it('should throw when RESYNC_BLOCK_HEIGHTS_UNTIL exceeds latest indexed block', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 200;
            mockVmStorage.getLatestBlock.mockResolvedValue({ height: 50 });

            await expect((indexer as any).init()).rejects.toThrow(
                'RESYNC_BLOCK_HEIGHTS_UNTIL (200) exceeds the highest indexed block (50)',
            );
        });

        it('should handle no blocks in DB (getLatestBlock returns null)', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 50;
            mockVmStorage.getLatestBlock.mockResolvedValue(null);

            await expect((indexer as any).init()).rejects.toThrow(
                'RESYNC_BLOCK_HEIGHTS_UNTIL (50) exceeds the highest indexed block (-1)',
            );
        });

        it('should handle getLatestBlock throwing an error (treats as no blocks)', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 10;
            mockVmStorage.getLatestBlock.mockRejectedValue(new Error('DB error'));

            await expect((indexer as any).init()).rejects.toThrow(
                'RESYNC_BLOCK_HEIGHTS_UNTIL (10) exceeds the highest indexed block (-1)',
            );
        });

        it('should allow RESYNC when RESYNC_BLOCK_HEIGHTS_UNTIL equals latest block height', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS_UNTIL = 100;
            mockVmStorage.getLatestBlock.mockResolvedValue({ height: 100 });

            await expect((indexer as any).init()).resolves.toBeUndefined();
        });

        it('should skip RESYNC validation when RESYNC_BLOCK_HEIGHTS is false', async () => {
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = false;

            await (indexer as any).init();

            expect(mockVmStorage.revertBlockHeadersOnly).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // plugin notification during startup
    // ========================================================================
    describe('plugin notification during startup', () => {
        it('should notify plugins when PLUGINS_ENABLED is true', async () => {
            mockConfig.PLUGINS.PLUGINS_ENABLED = true;

            await (indexer as any).init();

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    type: MessageType.PLUGIN_REORG,
                }),
            );
        });

        it('should not notify plugins when PLUGINS_ENABLED is false', async () => {
            mockConfig.PLUGINS.PLUGINS_ENABLED = false;

            await (indexer as any).init();

            expect(indexer.sendMessageToThread).not.toHaveBeenCalled();
        });

        it('should use reason "reindex" when REINDEX is true', async () => {
            mockConfig.PLUGINS.PLUGINS_ENABLED = true;
            mockConfig.OP_NET.REINDEX = true;
            mockConfig.OP_NET.REINDEX_FROM_BLOCK = 50;

            await (indexer as any).init();

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    data: expect.objectContaining({
                        reason: 'reindex',
                    }),
                }),
            );
        });

        it('should use reason "startup-purge" when REINDEX is false', async () => {
            mockConfig.PLUGINS.PLUGINS_ENABLED = true;

            await (indexer as any).init();

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    data: expect.objectContaining({
                        reason: 'startup-purge',
                    }),
                }),
            );
        });

        it('should pass purgeFromBlock as fromBlock in plugin notification', async () => {
            mockConfig.PLUGINS.PLUGINS_ENABLED = true;
            mockConfig.OP_NET.REINDEX = true;
            mockConfig.OP_NET.REINDEX_FROM_BLOCK = 42;

            await (indexer as any).init();

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    data: expect.objectContaining({
                        fromBlock: 42n,
                    }),
                }),
            );
        });

        it('should pass originalHeight as toBlock in plugin notification', async () => {
            mockConfig.PLUGINS.PLUGINS_ENABLED = true;
            mockChainObserver.pendingBlockHeight = 200n;

            await (indexer as any).init();

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    data: expect.objectContaining({
                        toBlock: 200n,
                    }),
                }),
            );
        });

        it('should catch and warn if plugin notification fails during startup', async () => {
            mockConfig.PLUGINS.PLUGINS_ENABLED = true;
            (indexer.sendMessageToThread as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('plugin thread not ready'),
            );

            // Should not throw - error is caught internally
            await (indexer as any).init();

            // The init method catches the error and continues
            // Verify it still proceeded to call watchdog init
            expect(mockReorgWatchdog.init).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // watchdog init after purge
    // ========================================================================
    describe('watchdog init after purge', () => {
        it('should call reorgWatchdog.init with originalHeight', async () => {
            mockChainObserver.pendingBlockHeight = 150n;

            await (indexer as any).init();

            expect(mockReorgWatchdog.init).toHaveBeenCalledWith(150n);
        });

        it('should call reorgWatchdog.init after purge completes', async () => {
            const callOrder: string[] = [];
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('purge');
            });
            mockReorgWatchdog.init.mockImplementation(async () => {
                callOrder.push('watchdog.init');
            });

            await (indexer as any).init();

            expect(callOrder.indexOf('purge')).toBeLessThan(callOrder.indexOf('watchdog.init'));
        });

        it('should trigger revertChain when watchdog height mismatches original', async () => {
            mockChainObserver.pendingBlockHeight = 100n;
            mockReorgWatchdog.pendingBlockHeight = 90n;

            await (indexer as any).init();

            // revertChain should have been called via onHeightMismatch, calling revertDataUntilBlock with the watchdog height
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(90n);
        });

        it('should not trigger revertChain when watchdog height matches original', async () => {
            mockChainObserver.pendingBlockHeight = 100n;
            mockReorgWatchdog.pendingBlockHeight = 100n;

            await (indexer as any).init();

            // revertDataUntilBlock is called once for the normal purge, not a second time
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledTimes(1);
        });

        it('should not trigger revertChain when watchdog height is -1n', async () => {
            mockChainObserver.pendingBlockHeight = 100n;
            mockReorgWatchdog.pendingBlockHeight = -1n;

            await (indexer as any).init();

            // Only the initial purge call, no mismatch-triggered revert
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledTimes(1);
        });

        it('should use "database-corrupted" as reason when height mismatch triggers revertChain', async () => {
            mockChainObserver.pendingBlockHeight = 100n;
            mockReorgWatchdog.pendingBlockHeight = 90n;

            await (indexer as any).init();

            // The revertChain call should send CHAIN_REORG with newBest='database-corrupted'
            expect(indexer.sendMessageToAllThreads).toHaveBeenCalledWith(
                ThreadTypes.SYNCHRONISATION,
                expect.objectContaining({
                    type: MessageType.CHAIN_REORG,
                    data: expect.objectContaining({
                        newBest: 'database-corrupted',
                    }),
                }),
            );
        });
    });

    // ========================================================================
    // READONLY_MODE
    // ========================================================================
    describe('READONLY_MODE', () => {
        beforeEach(() => {
            mockConfig.INDEXER.READONLY_MODE = true;
        });

        it('should call watchBlockchain and return early in READONLY_MODE', async () => {
            await (indexer as any).init();

            expect(mockChainObserver.watchBlockchain).toHaveBeenCalled();
        });

        it('should not call killAllPendingWrites (verifyCommitConflicts) in READONLY_MODE', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.killAllPendingWrites).not.toHaveBeenCalled();
        });

        it('should not purge any data in READONLY_MODE', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.revertDataUntilBlock).not.toHaveBeenCalled();
            expect(mockVmStorage.revertBlockHeadersOnly).not.toHaveBeenCalled();
            expect(mockChainObserver.setNewHeight).not.toHaveBeenCalled();
        });

        it('should still call vmStorage.init and chainObserver.init in READONLY_MODE', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.init).toHaveBeenCalled();
            expect(mockChainObserver.init).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // verifyCommitConflicts
    // ========================================================================
    describe('verifyCommitConflicts', () => {
        it('should call killAllPendingWrites during verifyCommitConflicts', async () => {
            await (indexer as any).init();

            expect(mockVmStorage.killAllPendingWrites).toHaveBeenCalled();
        });

        it('should throw when verifyCommitConflicts returns false (killAllPendingWrites fails)', async () => {
            mockVmStorage.killAllPendingWrites.mockRejectedValue(new Error('database locked'));

            await expect((indexer as any).init()).rejects.toThrow(
                'Database is locked or corrupted.',
            );
        });

        it('should call verifyCommitConflicts before any purge operations', async () => {
            const callOrder: string[] = [];
            mockVmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('killAllPendingWrites');
            });
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('revertDataUntilBlock');
            });

            await (indexer as any).init();

            expect(callOrder.indexOf('killAllPendingWrites')).toBeLessThan(
                callOrder.indexOf('revertDataUntilBlock'),
            );
        });
    });

    // ========================================================================
    // sequence verification
    // ========================================================================
    describe('sequence verification', () => {
        it('should call vmStorage.init before chainObserver.init', async () => {
            const callOrder: string[] = [];
            mockVmStorage.init.mockImplementation(async () => {
                callOrder.push('vmStorage.init');
            });
            mockChainObserver.init.mockImplementation(async () => {
                callOrder.push('chainObserver.init');
            });

            await (indexer as any).init();

            expect(callOrder.indexOf('vmStorage.init')).toBeLessThan(
                callOrder.indexOf('chainObserver.init'),
            );
        });

        it('should call chainObserver.init before verifyCommitConflicts', async () => {
            const callOrder: string[] = [];
            mockChainObserver.init.mockImplementation(async () => {
                callOrder.push('chainObserver.init');
            });
            mockVmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('verifyCommitConflicts');
            });

            await (indexer as any).init();

            expect(callOrder.indexOf('chainObserver.init')).toBeLessThan(
                callOrder.indexOf('verifyCommitConflicts'),
            );
        });

        it('should call purge before setNewHeight', async () => {
            const callOrder: string[] = [];
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('purge');
            });
            mockChainObserver.setNewHeight.mockImplementation(async () => {
                callOrder.push('setNewHeight');
            });

            await (indexer as any).init();

            expect(callOrder.indexOf('purge')).toBeLessThan(callOrder.indexOf('setNewHeight'));
        });

        it('should call setNewHeight before reorgWatchdog.init', async () => {
            const callOrder: string[] = [];
            mockChainObserver.setNewHeight.mockImplementation(async () => {
                callOrder.push('setNewHeight');
            });
            mockReorgWatchdog.init.mockImplementation(async () => {
                callOrder.push('watchdog.init');
            });

            await (indexer as any).init();

            expect(callOrder.indexOf('setNewHeight')).toBeLessThan(
                callOrder.indexOf('watchdog.init'),
            );
        });

        it('should call reorgWatchdog.init before registerEvents', async () => {
            const callOrder: string[] = [];
            mockReorgWatchdog.init.mockImplementation(async () => {
                callOrder.push('watchdog.init');
            });
            mockBlockFetcher.watchBlockChanges.mockImplementation(async () => {
                callOrder.push('registerEvents');
            });

            await (indexer as any).init();

            expect(callOrder.indexOf('watchdog.init')).toBeLessThan(
                callOrder.indexOf('registerEvents'),
            );
        });

        it('should complete full init sequence in correct order for normal startup', async () => {
            const callOrder: string[] = [];

            mockVmStorage.init.mockImplementation(async () => {
                callOrder.push('1:vmStorage.init');
            });
            mockChainObserver.init.mockImplementation(async () => {
                callOrder.push('2:chainObserver.init');
            });
            mockVmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('3:verifyCommitConflicts');
            });
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('4:purge');
            });
            mockChainObserver.setNewHeight.mockImplementation(async () => {
                callOrder.push('5:setNewHeight');
            });
            mockReorgWatchdog.init.mockImplementation(async () => {
                callOrder.push('6:watchdog.init');
            });
            mockBlockFetcher.watchBlockChanges.mockImplementation(async () => {
                callOrder.push('7:registerEvents');
            });

            await (indexer as any).init();

            expect(callOrder).toEqual([
                '1:vmStorage.init',
                '2:chainObserver.init',
                '3:verifyCommitConflicts',
                '4:purge',
                '5:setNewHeight',
                '6:watchdog.init',
                '7:registerEvents',
            ]);
        });
    });

    // ========================================================================
    // epochManager messaging wiring
    // ========================================================================
    describe('epochManager messaging wiring', () => {
        it('should wire epochManager.sendMessageToThread during init', async () => {
            await (indexer as any).init();

            expect(mockEpochManager.sendMessageToThread).toBe(indexer.sendMessageToThread);
        });
    });

    // ========================================================================
    // registerEvents behavior
    // ========================================================================
    describe('registerEvents', () => {
        it('should subscribe to block changes on block fetcher', async () => {
            await (indexer as any).init();

            expect(mockBlockFetcher.subscribeToBlockChanges).toHaveBeenCalled();
        });

        it('should subscribe to reorgs on the watchdog', async () => {
            await (indexer as any).init();

            expect(mockReorgWatchdog.subscribeToReorgs).toHaveBeenCalled();
        });

        it('should call watchBlockChanges with true on the block fetcher', async () => {
            await (indexer as any).init();

            expect(mockBlockFetcher.watchBlockChanges).toHaveBeenCalledWith(true);
        });
    });
});
