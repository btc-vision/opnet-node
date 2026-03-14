/**
 * chainReorged flag lifecycle under failure conditions.
 *
 * The revertChain() method has a finally block that resets chainReorged=false,
 * so the flag does NOT get stuck forever on error. However, the risk is:
 *
 * 1. revertDataUntilBlock() succeeds (data is partially reverted in storage)
 * 2. onChainReorganisation() throws
 * 3. finally resets chainReorged=false
 * 4. The node resumes processing but storage is in a PARTIALLY REVERTED state
 *
 * These tests confirm that behaviour (partial-revert inconsistency).
 */
import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockIndexer } from '../../../src/src/blockchain-indexer/processor/BlockIndexer.js';

/** Hoisted mocks (must be before vi.mock calls) */

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

/** Module mocks */

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

/** Test helpers */

function makeIndexer(): BlockIndexer {
    const indexer = new BlockIndexer();
    indexer.sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);
    indexer.sendMessageToThread = vi.fn().mockResolvedValue(null);
    Reflect.set(indexer, '_blockFetcher', mockBlockFetcher);
    Reflect.set(indexer, 'started', true);
    Reflect.set(indexer, 'taskInProgress', false);
    Reflect.set(indexer, 'indexingTasks', []);
    Reflect.set(indexer, 'chainReorged', false);
    return indexer;
}

/** Tests */

describe('chainReorged flag lifecycle under failure', () => {
    let indexer: BlockIndexer;

    beforeEach(() => {
        vi.clearAllMocks();
        mockVmStorage.killAllPendingWrites.mockResolvedValue(undefined);
        mockVmStorage.revertDataUntilBlock.mockResolvedValue(undefined);
        mockVmStorage.setReorg.mockResolvedValue(undefined);
        mockChainObserver.onChainReorganisation.mockResolvedValue(undefined);
        mockChainObserver.pendingBlockHeight = 100n;
        indexer = makeIndexer();
    });

    /**
     * C-1a: error handling resets chainReorged appropriately
     *
     * FIX: If storage was NOT modified (error before revertDataUntilBlock),
     * chainReorged resets to false (safe to unlock).
     * If storage WAS modified (error after revertDataUntilBlock),
     * chainReorged stays true (node LOCKED) and panic() is called.
     */

    describe('C-1a: finally block always resets chainReorged to false', () => {
        it('should reset chainReorged to false when revertDataUntilBlock throws', async () => {
            mockVmStorage.revertDataUntilBlock.mockRejectedValue(
                new Error('storage write failed'),
            );

            await expect(
                (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(98n, 100n, 'hash', true),
            ).rejects.toThrow('storage write failed');

            // storageModified=false (threw before revertDataUntilBlock succeeded), safe to unlock
            expect(Reflect.get(indexer, 'chainReorged')).toBe(false);
        });

        it('should reset chainReorged to false when killAllPendingWrites throws', async () => {
            mockVmStorage.killAllPendingWrites.mockRejectedValue(new Error('lock failed'));

            await expect(
                (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(98n, 100n, 'hash', true),
            ).rejects.toThrow('lock failed');

            // storageModified=false (threw before revertDataUntilBlock), safe to unlock
            expect(Reflect.get(indexer, 'chainReorged')).toBe(false);
        });

        it('should reset chainReorged to false when onChainReorganisation throws', async () => {
            mockChainObserver.onChainReorganisation.mockRejectedValue(
                new Error('observer exploded'),
            );

            await expect(
                (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(98n, 100n, 'hash', true),
            ).rejects.toThrow('observer exploded');

            // FIX: storageModified=true → panic() called, chainReorged stays TRUE (node LOCKED)
            expect(Reflect.get(indexer, 'chainReorged')).toBe(true);
        });

        it('should reset chainReorged to false when setReorg throws', async () => {
            mockVmStorage.setReorg.mockRejectedValue(new Error('setReorg failed'));

            await expect(
                (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(50n, 100n, 'hash', true),
            ).rejects.toThrow('setReorg failed');

            // setReorg is called from reorgFromHeight which runs AFTER revertDataUntilBlock
            // → storageModified=true → panic() called, chainReorged stays TRUE (node LOCKED)
            expect(Reflect.get(indexer, 'chainReorged')).toBe(true);
        });

        it('should reset chainReorged to false even when notifyPluginsOfReorg throws', async () => {
            (indexer.sendMessageToThread as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('plugin thread down'),
            );

            await expect(
                (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(50n, 100n, 'hash', false),
            ).rejects.toThrow('plugin thread down');

            // FIX: notifyPluginsOfReorg is after revertDataUntilBlock → storageModified=true
            // → panic() called, chainReorged stays TRUE (node LOCKED)
            expect(Reflect.get(indexer, 'chainReorged')).toBe(true);
        });
    });

    /**
     * C-1b: PARTIAL REVERT -- the fix verified
     *
     * FIX: revertDataUntilBlock() succeeds -> storageModified=true
     * onChainReorganisation() throws -> catch detects storageModified -> panic() called
     * chainReorged stays TRUE -- node is LOCKED, does NOT silently resume.
     */

    describe('C-1b: partial-revert inconsistency', () => {
        it('should CONFIRM: storage is reverted but observer is NOT updated when onChainReorganisation throws', async () => {
            // revertDataUntilBlock succeeds – storage rows for blocks 98-100 are deleted
            mockVmStorage.revertDataUntilBlock.mockResolvedValue(undefined);
            // onChainReorganisation throws – observer height stays at 100
            mockChainObserver.onChainReorganisation.mockRejectedValue(
                new Error('observer update failed'),
            );

            await expect(
                (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(98n, 100n, 'hash', true),
            ).rejects.toThrow('observer update failed');

            // FIX: revertDataUntilBlock was called (storage modified)
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(98n, true);

            // onChainReorganisation was attempted but threw
            expect(mockChainObserver.onChainReorganisation).toHaveBeenCalledTimes(1);

            // FIX: chainReorged stays TRUE — node is LOCKED, NOT resuming on inconsistent state
            expect(Reflect.get(indexer, 'chainReorged')).toBe(true);
        });

        it('should CONFIRM: no reorg record written to DB when partial revert occurs', async () => {
            // Both storage-level and observer-level operations partially fail:
            // Step 1: killAllPendingWrites succeeds
            // Step 2: revertDataUntilBlock succeeds (blocks deleted from DB)
            // Step 3: onChainReorganisation throws
            // Step 4: setReorg is NEVER called → no reorg record

            mockVmStorage.revertDataUntilBlock.mockResolvedValue(undefined);
            mockChainObserver.onChainReorganisation.mockRejectedValue(
                new Error('chain observer dead'),
            );

            await expect(
                (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(50n, 100n, 'reorg-hash', true),
            ).rejects.toThrow('chain observer dead');

            // setReorg never called → no reorg record in DB
            expect(mockVmStorage.setReorg).not.toHaveBeenCalled();
            // But storage WAS modified (revertDataUntilBlock was called)
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(50n, true);
        });
    });

    /** C-1c: onHeightRegressionDetected swallows the error */

    describe('C-1c: onHeightRegressionDetected calls panic() but does NOT re-throw', () => {
        it('should NOT re-throw when revertChain throws inside onHeightRegressionDetected', async () => {
            // Set up a regression scenario
            mockChainObserver.pendingBlockHeight = 100n;
            mockVmStorage.revertDataUntilBlock.mockRejectedValue(new Error('db failure'));

            const panicSpy = vi.spyOn(indexer as never as { panic: (...a: unknown[]) => void }, 'panic');

            // Trigger the height regression path
            const onHeightRegression = Reflect.get(
                indexer,
                'onHeightRegressionDetected',
            ) as (h: bigint, hash: string) => Promise<void>;

            // Should NOT throw - the catch calls panic() but does not re-throw
            await expect(
                onHeightRegression.call(indexer, 98n, 'reorg-hash'),
            ).resolves.toBeUndefined();

            // Panic was called with the error message
            expect(panicSpy).toHaveBeenCalledWith(
                expect.stringContaining('Height regression reorg failed'),
            );

            // chainReorged was reset by finally block
            expect(Reflect.get(indexer, 'chainReorged')).toBe(false);
        });

        it('should allow processing to resume after onHeightRegressionDetected failure (startTasks called when successful)', async () => {
            // When revertChain succeeds, startTasks is called
            mockChainObserver.pendingBlockHeight = 100n;
            mockVmStorage.revertDataUntilBlock.mockResolvedValue(undefined);
            mockChainObserver.onChainReorganisation.mockResolvedValue(undefined);

            const startTasksSpy = vi.spyOn(indexer as never as { startTasks: () => void }, 'startTasks');

            const onHeightRegression = Reflect.get(
                indexer,
                'onHeightRegressionDetected',
            ) as (h: bigint, hash: string) => Promise<void>;

            await onHeightRegression.call(indexer, 98n, 'reorg-hash');

            // startTasks should have been called after successful revert
            expect(startTasksSpy).toHaveBeenCalled();
        });
    });

    /** C-1d: Verify the finally block timing */

    describe('C-1d: chainReorged flag is true throughout revertChain and false afterward', () => {
        it('chainReorged is true during revertDataUntilBlock execution', async () => {
            let flagDuringRevert = false;
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                flagDuringRevert = Reflect.get(indexer, 'chainReorged') as boolean;
            });

            await (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(98n, 100n, 'hash', true);

            expect(flagDuringRevert).toBe(true);
            // After completion, flag is false
            expect(Reflect.get(indexer, 'chainReorged')).toBe(false);
        });

        it('chainReorged is true during onChainReorganisation execution', async () => {
            let flagDuringObserver = false;
            mockChainObserver.onChainReorganisation.mockImplementation(async () => {
                flagDuringObserver = Reflect.get(indexer, 'chainReorged') as boolean;
            });

            await (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(98n, 100n, 'hash', true);

            expect(flagDuringObserver).toBe(true);
            expect(Reflect.get(indexer, 'chainReorged')).toBe(false);
        });

        it('chainReorged is true during setReorg execution', async () => {
            let flagDuringSetReorg = false;
            mockVmStorage.setReorg.mockImplementation(async () => {
                flagDuringSetReorg = Reflect.get(indexer, 'chainReorged') as boolean;
            });

            await (indexer as never as { revertChain: (...a: unknown[]) => Promise<void> }).revertChain(50n, 100n, 'hash', true);

            expect(flagDuringSetReorg).toBe(true);
            expect(Reflect.get(indexer, 'chainReorged')).toBe(false);
        });
    });
});
