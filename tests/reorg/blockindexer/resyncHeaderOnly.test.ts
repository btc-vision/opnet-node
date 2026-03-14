/**
 * Tests for queryBlockHeaderOnly behaviour with RESYNC_BLOCK_HEIGHTS=true.
 *
 * 1. BlockIndexer.init() calls revertBlockHeadersOnly (not revertDataUntilBlock) when RESYNC=true
 * 2. queryBlockHeaderOnly validates hash consistency (non-atomic RPC fix)
 * 3. queryBlockHeaderOnly guards against Number() precision loss
 * 4. queryBlock delegates to queryBlockHeaderOnly when RESYNC=true
 */
import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockIndexer } from '../../../src/src/blockchain-indexer/processor/BlockIndexer.js';
import { ChainSynchronisation } from '../../../src/src/blockchain-indexer/sync/classes/ChainSynchronisation.js';

/** Hoisted mocks */

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
        RESYNC_BLOCK_HEIGHTS: true,
        RESYNC_BLOCK_HEIGHTS_UNTIL: 800000,
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
    getBlockHeader: vi.fn().mockResolvedValue(undefined),
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
vi.mock('@btc-vision/bsi-common', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        ConfigurableDBManager: vi.fn(function (this: Record<string, unknown>) {
            this.db = null;
        }),
    };
});
vi.mock('@btc-vision/bitcoin-rpc', () => ({
    BitcoinRPC: vi.fn(function () {
        return { init: vi.fn().mockResolvedValue(undefined) };
    }),
}));
vi.mock('@btc-vision/bitcoin', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@btc-vision/bitcoin')>();
    return { ...actual };
});
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

/** Helper to build a BlockIndexer with internal mocks wired */

function createBlockIndexer(): BlockIndexer {
    const indexer = Reflect.construct(BlockIndexer, []) as BlockIndexer;
    Reflect.set(indexer, 'vmStorage', mockVmStorage);
    Reflect.set(indexer, 'chainObserver', mockChainObserver);
    Reflect.set(indexer, 'blockFetcher', mockBlockFetcher);
    Reflect.set(indexer, 'reorgWatchdog', mockReorgWatchdog);
    Reflect.set(indexer, 'vmManager', mockVmManager);
    Reflect.set(indexer, 'epochManager', mockEpochManager);
    Reflect.set(indexer, 'epochReindexer', mockEpochReindexer);
    Reflect.set(indexer, 'chainReorged', false);
    Reflect.set(indexer, 'started', false);
    Reflect.set(indexer, 'indexingTasks', []);
    Reflect.set(indexer, 'sendMessageToThread', vi.fn().mockResolvedValue(undefined));
    Reflect.set(indexer, 'sendMessageToAllThreads', vi.fn().mockResolvedValue(undefined));
    return indexer;
}

/** Helper to build a ChainSynchronisation with mock RPC */

// Valid 64-char hex strings for block hashes (Block constructor calls fromHex on hash)
const VALID_HASH_A = 'aa'.repeat(32); // 64 hex chars
const VALID_HASH_B = 'bb'.repeat(32);
const VALID_HASH_PREV = 'cc'.repeat(32);
const VALID_MERKLE = 'dd'.repeat(32);

function createChainSync(rpcOverrides: Record<string, unknown> = {}) {
    const mockRpc = {
        getBlockHash: vi.fn().mockResolvedValue(VALID_HASH_A),
        getBlockInfoOnly: vi.fn().mockResolvedValue({
            hash: VALID_HASH_A,
            height: 100,
            previousblockhash: VALID_HASH_PREV,
            nTx: 1,
            tx: ['txid1'],
            time: 1234567890,
            mediantime: 1234567800,
            bits: '1d00ffff',
            difficulty: 1,
            chainwork: '0000000000000000000000000000000000000000000000000000000100010001',
            nonce: 42,
            version: 1,
            versionHex: '00000001',
            merkleroot: VALID_MERKLE,
            weight: 800,
        }),
        ...rpcOverrides,
    };

    const sync = Reflect.construct(ChainSynchronisation, []) as ChainSynchronisation;
    Reflect.set(sync, 'rpcClient', mockRpc);
    Reflect.set(sync, 'network', {});
    Reflect.set(sync, 'abortControllers', new Map());
    Reflect.set(sync, 'bestTip', 0n);

    return { sync, mockRpc };
}

/** Tests */

describe('RESYNC_BLOCK_HEIGHTS behaviour and queryBlockHeaderOnly fixes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;
    });

    /** C-4a: BlockIndexer.init calls revertBlockHeadersOnly in resync mode */

    // C-4a tests removed: they tested their own local if/else, never called production code.

    /** C-4b: queryBlockHeaderOnly returns empty tx data */

    describe('C-4b: queryBlockHeaderOnly returns empty rawTransactionData', () => {
        it('should return rawTransactionData=[] and transactionOrder=undefined from queryBlockHeaderOnly', async () => {
            const { sync } = createChainSync();

            // Call the actual private method
            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            const result = await queryBlockHeaderOnly.call(sync, 100n);

            expect(result.rawTransactionData).toEqual([]);
            expect(result.transactionOrder).toBeUndefined();
        });

        it('should populate addressCache as empty Map', async () => {
            const { sync } = createChainSync();

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            const result = await queryBlockHeaderOnly.call(sync, 100n);

            expect(result.addressCache).toBeInstanceOf(Map);
            expect(result.addressCache.size).toBe(0);
        });

        it('should set bestTip to the requested block number', async () => {
            const { sync } = createChainSync();

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            await queryBlockHeaderOnly.call(sync, 42n);

            expect(Reflect.get(sync, 'bestTip')).toBe(42n);
        });
    });

    /** C-4c: Hash mismatch detection (non-atomic RPC fix) */

    describe('C-4c: queryBlockHeaderOnly detects hash mismatch between RPC calls', () => {
        it('should throw when getBlockHash and getBlockInfoOnly return different hashes', async () => {
            const { sync } = createChainSync({
                getBlockHash: vi.fn().mockResolvedValue(VALID_HASH_A),
                getBlockInfoOnly: vi.fn().mockResolvedValue({
                    hash: VALID_HASH_B,  // DIFFERENT hash
                    height: 100,
                    previousblockhash: VALID_HASH_PREV,
                    nTx: 0,
                    tx: [],
                    time: 0,
                    mediantime: 0,
                    bits: '1d00ffff',
                    difficulty: 0,
                    chainwork: '0000000000000000000000000000000000000000000000000000000100010001',
                    nonce: 0,
                    version: 1,
                    versionHex: '00000001',
                    merkleroot: VALID_MERKLE,
                    weight: 0,
                }),
            });

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            await expect(queryBlockHeaderOnly.call(sync, 100n)).rejects.toThrow(
                /Block hash mismatch during resync/,
            );
        });

        it('should NOT throw when hashes match', async () => {
            const { sync } = createChainSync({
                getBlockHash: vi.fn().mockResolvedValue(VALID_HASH_A),
                getBlockInfoOnly: vi.fn().mockResolvedValue({
                    hash: VALID_HASH_A,  // SAME hash
                    height: 100,
                    previousblockhash: VALID_HASH_PREV,
                    nTx: 1,
                    tx: ['tx1'],
                    time: 0,
                    mediantime: 0,
                    bits: '1d00ffff',
                    difficulty: 0,
                    chainwork: '0000000000000000000000000000000000000000000000000000000100010001',
                    nonce: 0,
                    version: 1,
                    versionHex: '00000001',
                    merkleroot: VALID_MERKLE,
                    weight: 0,
                }),
            });

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            await expect(queryBlockHeaderOnly.call(sync, 100n)).resolves.toBeDefined();
        });

        it('should throw when getBlockHash returns null', async () => {
            const { sync } = createChainSync({
                getBlockHash: vi.fn().mockResolvedValue(null),
            });

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            await expect(queryBlockHeaderOnly.call(sync, 100n)).rejects.toThrow(
                /Block hash not found/,
            );
        });

        it('should throw when getBlockInfoOnly returns null', async () => {
            const { sync } = createChainSync({
                getBlockInfoOnly: vi.fn().mockResolvedValue(null),
            });

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            await expect(queryBlockHeaderOnly.call(sync, 100n)).rejects.toThrow(
                /Block header not found/,
            );
        });
    });

    /** C-4d: Number() precision guard */

    describe('C-4d: queryBlockHeaderOnly guards against Number() precision loss', () => {
        it('should throw for block numbers exceeding MAX_SAFE_INTEGER', async () => {
            const { sync } = createChainSync();

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            const unsafeHeight = BigInt(Number.MAX_SAFE_INTEGER) + 2n;

            await expect(queryBlockHeaderOnly.call(sync, unsafeHeight)).rejects.toThrow(
                /exceeds safe integer range/,
            );
        });

        it('should NOT throw for block numbers at MAX_SAFE_INTEGER', async () => {
            const { sync, mockRpc } = createChainSync();

            // MAX_SAFE_INTEGER itself is safe
            const safeHeight = BigInt(Number.MAX_SAFE_INTEGER);

            mockRpc.getBlockHash.mockResolvedValue(VALID_HASH_A);
            mockRpc.getBlockInfoOnly.mockResolvedValue({
                hash: VALID_HASH_A,
                height: Number.MAX_SAFE_INTEGER,
                previousblockhash: VALID_HASH_PREV,
                nTx: 0,
                tx: [],
                time: 0,
                mediantime: 0,
                bits: '1d00ffff',
                difficulty: 0,
                chainwork: '0000000000000000000000000000000000000000000000000000000100010001',
                nonce: 0,
                version: 1,
                versionHex: '00000001',
                merkleroot: VALID_MERKLE,
                weight: 0,
            });

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            await expect(queryBlockHeaderOnly.call(sync, safeHeight)).resolves.toBeDefined();
        });

        it('should NOT throw for current Bitcoin heights', async () => {
            const { sync } = createChainSync();

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            // Current Bitcoin height ~900k, well within safe range
            await expect(queryBlockHeaderOnly.call(sync, 900_000n)).resolves.toBeDefined();
        });

        it('should pass the correct Number-converted height to getBlockHash', async () => {
            const { sync, mockRpc } = createChainSync();

            const queryBlockHeaderOnly = Reflect.get(sync, 'queryBlockHeaderOnly') as Function;
            await queryBlockHeaderOnly.call(sync, 850_000n);

            expect(mockRpc.getBlockHash).toHaveBeenCalledWith(850_000);
        });
    });

    /** C-4e: queryBlock delegates to queryBlockHeaderOnly in resync mode */

    describe('C-4e: queryBlock delegates to queryBlockHeaderOnly when RESYNC=true', () => {
        it('should call queryBlockHeaderOnly when RESYNC_BLOCK_HEIGHTS=true', async () => {
            const { sync } = createChainSync();
            mockConfig.DEV.RESYNC_BLOCK_HEIGHTS = true;

            const queryBlockHeaderOnlySpy = vi.spyOn(sync as never, 'queryBlockHeaderOnly');
            // Ensure we have the spy before calling
            Reflect.set(sync, 'queryBlockHeaderOnly', queryBlockHeaderOnlySpy);

            const queryBlock = Reflect.get(sync, 'queryBlock') as Function;
            await queryBlock.call(sync, 100n);

            // queryBlock should have delegated to queryBlockHeaderOnly
            expect(queryBlockHeaderOnlySpy).toHaveBeenCalledWith(100n);
        });
    });
});
