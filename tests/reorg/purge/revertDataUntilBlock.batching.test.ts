import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllMockRepositories, createAllMockRepositories } from '../mocks/mockRepositories.js';
import { createMockVMMongoStorage, injectMockRepositories } from '../mocks/mockVMStorage.js';
import { VMMongoStorage } from '../../../src/src/vm/storage/databases/VMMongoStorage.js';

// vi.hoisted runs before vi.mock hoisting, so mockConfig is available in the factory
const mockConfig = vi.hoisted(() => {
    return {
        DEV_MODE: false,
        OP_NET: {
            REINDEX_BATCH_SIZE: 1000,
            REINDEX_PURGE_UTXOS: true,
            REINDEX: false,
            REINDEX_FROM_BLOCK: 0,
            EPOCH_REINDEX: false,
            EPOCH_REINDEX_FROM_EPOCH: 0,
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
            RESYNC_BLOCK_HEIGHTS: false,
            RESYNC_BLOCK_HEIGHTS_UNTIL: 0,
            ALWAYS_ENABLE_REORG_VERIFICATION: false,
            PROCESS_ONLY_X_BLOCK: 0,
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
            NETWORK: 'regtest',
            CHAIN_ID: 0,
        },
        PLUGINS: {
            PLUGINS_ENABLED: false,
            PLUGINS_DIR: '',
            WORKER_POOL_SIZE: 1,
            EMIT_ERROR_OR_WARNING: false,
        },
        INDEXER: {
            READONLY_MODE: false,
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
});

vi.mock('../../../src/src/config/Config.js', () => ({
    Config: mockConfig,
}));

describe('revertDataUntilBlock - batch logic', () => {
    let mocks: AllMockRepositories;
    let storage: VMMongoStorage;

    /**
     * Helper: configure getLatestBlock to return a specific height.
     */
    function setLatestBlockHeight(height: number | undefined): void {
        if (height === undefined) {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
        } else {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => String(height) },
            });
        }
    }

    /**
     * Helper: configure blockchainInfoRepository with specific inProgressBlock.
     */
    function setChainInfoHeight(inProgressBlock: number): void {
        mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
            inProgressBlock,
        });
    }

    /**
     * Helper: get the number of batched InRange calls made (using transactionRepository).
     */
    function getBatchCount(): number {
        return mocks.transactionRepository.deleteTransactionsInRange.mock.calls.length;
    }

    /**
     * Helper: get all batched [from, to] pairs (using transactionRepository).
     */
    function getBatchRanges(): [bigint, bigint][] {
        return mocks.transactionRepository.deleteTransactionsInRange.mock.calls.map(
            (call: bigint[]) => [call[0], call[1]] as [bigint, bigint],
        );
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks = createAllMockRepositories();
        storage = createMockVMMongoStorage(mockConfig);
        injectMockRepositories(storage, mocks);

        // Defaults
        mockConfig.DEV_MODE = false;
        mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
        mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
        mockConfig.BITCOIN.NETWORK = 'regtest';

        mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
        mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
    });

    // Tests 81-90: batch count calculation

    describe('batch count calculation', () => {
        it('81 - zero batches when upperBound == blockId', async () => {
            setLatestBlockHeight(100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(getBatchCount()).toBe(0);
        });

        it('82 - one batch when range == BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            setLatestBlockHeight(1100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // upperBound=1100, blockId=100, range=1000, 1 batch
            expect(getBatchCount()).toBe(1);
        });

        it('83 - one batch when range < BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // upperBound=200, blockId=100, range=100, 1 batch
            expect(getBatchCount()).toBe(1);
        });

        it('84 - two batches when range == 2 * BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 500;
            setLatestBlockHeight(1100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // upperBound=1100, blockId=100, range=1000, 2 batches
            expect(getBatchCount()).toBe(2);
        });

        it('85 - two batches when range is between BATCH_SIZE and 2*BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 500;
            setLatestBlockHeight(850);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // upperBound=850, blockId=100, range=750, ceil(750/500)=2 batches
            expect(getBatchCount()).toBe(2);
        });

        it('86 - three batches for range == 3 * BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(400);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // upperBound=400, blockId=100, range=300, 3 batches
            expect(getBatchCount()).toBe(3);
        });

        it('87 - ceil(range/batchSize) batches for non-exact division', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(350);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // upperBound=350, blockId=100, range=250, ceil(250/100)=3 batches
            expect(getBatchCount()).toBe(3);
        });

        it('88 - five batches for range == 5 * BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
            setLatestBlockHeight(60);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            // upperBound=60, blockId=10, range=50, 5 batches
            expect(getBatchCount()).toBe(5);
        });

        it('89 - one batch when range == 1 and BATCH_SIZE == 1', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1;
            setLatestBlockHeight(2);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(1n);
            // upperBound=2, blockId=1, range=1, 1 batch
            expect(getBatchCount()).toBe(1);
        });

        it('90 - many batches for large range with small batch size', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 5;
            setLatestBlockHeight(100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            // upperBound=100, blockId=0, range=100, 100/5=20 batches
            expect(getBatchCount()).toBe(20);
        });
    });

    // Tests 91-96: batch direction (walks DOWN)

    describe('batch direction (walks DOWN)', () => {
        it('91 - first batch has the highest "to" value', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(400);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            // First batch should have the highest "to"
            expect(ranges[0][1]).toBe(400n);
        });

        it('92 - last batch has the lowest "to" value', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(400);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            // Last batch: to=200 (upperBound - 2*BATCH_SIZE = 400 - 200 = 200)
            expect(ranges[ranges.length - 1][1]).toBe(200n);
        });

        it('93 - "to" decreases with each successive batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            for (let i = 1; i < ranges.length; i++) {
                expect(ranges[i][1]).toBeLessThan(ranges[i - 1][1]);
            }
        });

        it('94 - "from" also decreases with each successive batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            for (let i = 1; i < ranges.length; i++) {
                expect(ranges[i][0]).toBeLessThan(ranges[i - 1][0]);
            }
        });

        it('95 - each batch "to" equals previous batch "from"', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            for (let i = 1; i < ranges.length; i++) {
                // Current "to" = previous "to" - BATCH_SIZE = previous "from" (when exact)
                expect(ranges[i][1]).toBe(ranges[i - 1][0]);
            }
        });

        it('96 - batches collectively cover entire range without gaps', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 30;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            // Last batch "from" should be blockId
            expect(ranges[ranges.length - 1][0]).toBe(100n);
            // First batch "to" should be upperBound
            expect(ranges[0][1]).toBe(200n);
        });
    });

    // Tests 97-101: batch range [from, to) correctness

    describe('batch range [from, to) correctness', () => {
        it('97 - single batch: from == blockId, to == upperBound', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([100n, 200n]);
        });

        it('98 - two even batches have correct ranges', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(2);
            // First batch: to=300, from=max(300-100, 100)=200
            expect(ranges[0]).toEqual([200n, 300n]);
            // Second batch: to=200, from=max(200-100, 100)=100
            expect(ranges[1]).toEqual([100n, 200n]);
        });

        it('99 - three batches with remainder have correct last from', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(350);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(3);
            // First batch: from=250, to=350
            expect(ranges[0]).toEqual([250n, 350n]);
            // Second batch: from=150, to=250
            expect(ranges[1]).toEqual([150n, 250n]);
            // Third batch: from=max(50, 100)=100, to=150
            expect(ranges[2]).toEqual([100n, 150n]);
        });

        it('100 - from never goes below blockId', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 70;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            for (const [from] of ranges) {
                expect(from).toBeGreaterThanOrEqual(100n);
            }
        });

        it('101 - to never goes below blockId', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 70;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            for (const [, to] of ranges) {
                expect(to).toBeGreaterThan(100n);
            }
        });
    });

    // Tests 102-106: BATCH_SIZE = 1

    describe('BATCH_SIZE = 1', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1;
        });

        it('102 - range of 1 produces 1 batch', async () => {
            setLatestBlockHeight(11);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            expect(getBatchCount()).toBe(1);
        });

        it('103 - range of 5 produces 5 batches', async () => {
            setLatestBlockHeight(15);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            expect(getBatchCount()).toBe(5);
        });

        it('104 - each batch covers exactly one block step', async () => {
            setLatestBlockHeight(5);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(2n);
            const ranges = getBatchRanges();
            // 3 batches: [4,5], [3,4], [2,3]
            expect(ranges).toHaveLength(3);
            expect(ranges[0]).toEqual([4n, 5n]);
            expect(ranges[1]).toEqual([3n, 4n]);
            expect(ranges[2]).toEqual([2n, 3n]);
        });

        it('105 - range of 10 produces 10 batches', async () => {
            setLatestBlockHeight(20);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            expect(getBatchCount()).toBe(10);
        });

        it('106 - no batch overlap with BATCH_SIZE=1', async () => {
            setLatestBlockHeight(8);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(5n);
            const ranges = getBatchRanges();
            // Each batch's to should equal next batch's from + 1 (i.e. previous batch's to)
            for (let i = 1; i < ranges.length; i++) {
                expect(ranges[i][1]).toBe(ranges[i - 1][0]);
            }
        });
    });

    // Tests 107-112: BATCH_SIZE = 10

    describe('BATCH_SIZE = 10', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
        });

        it('107 - range of 10 produces 1 batch', async () => {
            setLatestBlockHeight(20);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            expect(getBatchCount()).toBe(1);
        });

        it('108 - range of 20 produces 2 batches', async () => {
            setLatestBlockHeight(30);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            expect(getBatchCount()).toBe(2);
        });

        it('109 - range of 25 produces 3 batches', async () => {
            setLatestBlockHeight(35);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            // range=25, ceil(25/10)=3
            expect(getBatchCount()).toBe(3);
        });

        it('110 - exact ranges for 2 batches with BATCH_SIZE=10', async () => {
            setLatestBlockHeight(30);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            const ranges = getBatchRanges();
            expect(ranges[0]).toEqual([20n, 30n]);
            expect(ranges[1]).toEqual([10n, 20n]);
        });

        it('111 - last batch truncated to blockId for non-even division', async () => {
            setLatestBlockHeight(33);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            const ranges = getBatchRanges();
            // First: from=23, to=33
            // Second: from=13, to=23
            // Third: from=max(3, 10)=10, to=13
            expect(ranges[ranges.length - 1][0]).toBe(10n);
        });

        it('112 - range of 5 produces 1 batch with from clamped', async () => {
            setLatestBlockHeight(15);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(10n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([10n, 15n]);
        });
    });

    // Tests 113-119: BATCH_SIZE = 100

    describe('BATCH_SIZE = 100', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
        });

        it('113 - range of 100 produces 1 batch', async () => {
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(getBatchCount()).toBe(1);
        });

        it('114 - range of 500 produces 5 batches', async () => {
            setLatestBlockHeight(600);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(getBatchCount()).toBe(5);
        });

        it('115 - range of 150 produces 2 batches', async () => {
            setLatestBlockHeight(250);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(getBatchCount()).toBe(2);
        });

        it('116 - exact ranges for 3 even batches', async () => {
            setLatestBlockHeight(400);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toEqual([
                [300n, 400n],
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('117 - remainder batch from is clamped to blockId', async () => {
            setLatestBlockHeight(370);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            // batch 1: from=270, to=370
            // batch 2: from=170, to=270
            // batch 3: from=max(70, 100)=100, to=170
            expect(ranges[2]).toEqual([100n, 170n]);
        });

        it('118 - range of 1 produces 1 batch with small span', async () => {
            setLatestBlockHeight(101);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([100n, 101n]);
        });

        it('119 - range of 99 produces 1 batch', async () => {
            setLatestBlockHeight(199);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([100n, 199n]);
        });
    });

    // Tests 120-124: BATCH_SIZE = 1000 (default)

    describe('BATCH_SIZE = 1000 (default)', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
        });

        it('120 - range of 1000 produces 1 batch', async () => {
            setLatestBlockHeight(2000);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(1000n);
            expect(getBatchCount()).toBe(1);
        });

        it('121 - range of 5000 produces 5 batches', async () => {
            setLatestBlockHeight(6000);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(1000n);
            expect(getBatchCount()).toBe(5);
        });

        it('122 - range of 1500 produces 2 batches', async () => {
            setLatestBlockHeight(2500);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(1000n);
            expect(getBatchCount()).toBe(2);
        });

        it('123 - range of 999 produces 1 batch', async () => {
            setLatestBlockHeight(1999);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(1000n);
            expect(getBatchCount()).toBe(1);
        });

        it('124 - exact ranges for 3 batches with default size', async () => {
            setLatestBlockHeight(4000);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(1000n);
            const ranges = getBatchRanges();
            expect(ranges).toEqual([
                [3000n, 4000n],
                [2000n, 3000n],
                [1000n, 2000n],
            ]);
        });
    });

    // Tests 125-128: BATCH_SIZE = 10000

    describe('BATCH_SIZE = 10000', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10000;
        });

        it('125 - range of 10000 produces 1 batch', async () => {
            setLatestBlockHeight(10100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(getBatchCount()).toBe(1);
        });

        it('126 - range of 30000 produces 3 batches', async () => {
            setLatestBlockHeight(30100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(getBatchCount()).toBe(3);
        });

        it('127 - range of 5000 produces 1 batch (less than BATCH_SIZE)', async () => {
            setLatestBlockHeight(5100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([100n, 5100n]);
        });

        it('128 - range of 15000 produces 2 batches', async () => {
            setLatestBlockHeight(15100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(2);
            // First: from=5100, to=15100
            expect(ranges[0]).toEqual([5100n, 15100n]);
            // Second: from=100, to=5100
            expect(ranges[1]).toEqual([100n, 5100n]);
        });
    });

    // Tests 129-132: BATCH_SIZE larger than range

    describe('BATCH_SIZE larger than range', () => {
        it('129 - BATCH_SIZE=10000, range=100 produces 1 batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10000;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([100n, 200n]);
        });

        it('130 - BATCH_SIZE=1000000, range=50 produces 1 batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1_000_000;
            setLatestBlockHeight(150);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([100n, 150n]);
        });

        it('131 - BATCH_SIZE=100, range=1 produces 1 batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(101);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0]).toEqual([100n, 101n]);
        });

        it('132 - BATCH_SIZE=999999, range=10 with from clamped', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 999_999;
            setLatestBlockHeight(110);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            expect(ranges).toHaveLength(1);
            expect(ranges[0][0]).toBe(100n);
            expect(ranges[0][1]).toBe(110n);
        });
    });

    // Tests 133-147: batch argument verification per repository

    describe('batch argument verification per repository', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
        });

        it('133 - transactionRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('134 - contractRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.contractRepository.deleteContractsInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('135 - pointerRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.pointerRepository.deletePointerInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('136 - blockRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.blockRepository.deleteBlockHeadersInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('137 - blockWitnessRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.blockWitnessRepository.deleteBlockWitnessesInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('138 - reorgRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.reorgRepository.deleteReorgsInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('139 - epochRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.epochRepository.deleteEpochInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('140 - epochSubmissionRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.epochSubmissionRepository.deleteSubmissionsInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('141 - unspentTransactionRepository receives correct batch args when purgeUtxos=true', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.unspentTransactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('142 - unspentTransactionRepository NOT called when purgeUtxos=false', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsInRange,
            ).not.toHaveBeenCalled();
        });

        it('143 - mldsaPublicKeysRepository receives correct batch args', async () => {
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const calls = mocks.mldsaPublicKeysRepository.deleteInRange.mock.calls;
            expect(calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('144 - all repos receive the same batch count', async () => {
            setLatestBlockHeight(400);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const expectedCount = 3;
            expect(mocks.transactionRepository.deleteTransactionsInRange.mock.calls.length).toBe(
                expectedCount,
            );
            expect(mocks.contractRepository.deleteContractsInRange.mock.calls.length).toBe(
                expectedCount,
            );
            expect(mocks.pointerRepository.deletePointerInRange.mock.calls.length).toBe(
                expectedCount,
            );
            expect(mocks.blockRepository.deleteBlockHeadersInRange.mock.calls.length).toBe(
                expectedCount,
            );
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange.mock.calls.length).toBe(
                expectedCount,
            );
            expect(mocks.reorgRepository.deleteReorgsInRange.mock.calls.length).toBe(expectedCount);
            expect(mocks.epochRepository.deleteEpochInRange.mock.calls.length).toBe(expectedCount);
            expect(mocks.epochSubmissionRepository.deleteSubmissionsInRange.mock.calls.length).toBe(
                expectedCount,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteInRange.mock.calls.length).toBe(
                expectedCount,
            );
        });

        it('145 - all repos get identical from/to pairs for each batch', async () => {
            setLatestBlockHeight(350);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const txCalls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            const contractCalls = mocks.contractRepository.deleteContractsInRange.mock.calls;
            const pointerCalls = mocks.pointerRepository.deletePointerInRange.mock.calls;
            const blockCalls = mocks.blockRepository.deleteBlockHeadersInRange.mock.calls;
            const witnessCalls =
                mocks.blockWitnessRepository.deleteBlockWitnessesInRange.mock.calls;
            const reorgCalls = mocks.reorgRepository.deleteReorgsInRange.mock.calls;

            for (let i = 0; i < txCalls.length; i++) {
                expect(contractCalls[i]).toEqual(txCalls[i]);
                expect(pointerCalls[i]).toEqual(txCalls[i]);
                expect(blockCalls[i]).toEqual(txCalls[i]);
                expect(witnessCalls[i]).toEqual(txCalls[i]);
                expect(reorgCalls[i]).toEqual(txCalls[i]);
            }
        });

        it('146 - three batches with remainder: all repos get correct last from', async () => {
            setLatestBlockHeight(370);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const lastTxCall = mocks.transactionRepository.deleteTransactionsInRange.mock.calls[2];
            expect(lastTxCall[0]).toBe(100n);
            expect(lastTxCall[1]).toBe(170n);

            const lastContractCall = mocks.contractRepository.deleteContractsInRange.mock.calls[2];
            expect(lastContractCall[0]).toBe(100n);
            expect(lastContractCall[1]).toBe(170n);
        });

        it('147 - single batch: every repo called exactly once with full range', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10000;
            setLatestBlockHeight(500);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);

            const allRepos = [
                mocks.transactionRepository.deleteTransactionsInRange,
                mocks.contractRepository.deleteContractsInRange,
                mocks.pointerRepository.deletePointerInRange,
                mocks.blockRepository.deleteBlockHeadersInRange,
                mocks.blockWitnessRepository.deleteBlockWitnessesInRange,
                mocks.reorgRepository.deleteReorgsInRange,
                mocks.epochRepository.deleteEpochInRange,
                mocks.epochSubmissionRepository.deleteSubmissionsInRange,
                mocks.mldsaPublicKeysRepository.deleteInRange,
            ];
            for (const repo of allRepos) {
                expect(repo).toHaveBeenCalledTimes(1);
                expect(repo.mock.calls[0]).toEqual([100n, 500n]);
            }
        });
    });

    // Tests 148-150: BATCH_SIZE = 0 or negative edge case

    describe('BATCH_SIZE = 0 or negative edge case', () => {
        it('148 - BATCH_SIZE=0 falls back to 1000 (falsy check)', async () => {
            // Config.OP_NET.REINDEX_BATCH_SIZE = 0
            // Code: BigInt(Config.OP_NET.REINDEX_BATCH_SIZE || 1_000)
            // 0 is falsy, so it falls back to 1000
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 0;
            setLatestBlockHeight(2100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // With fallback 1000: range=2000, 2 batches
            expect(getBatchCount()).toBe(2);
        });

        it('149 - BATCH_SIZE=0 fallback produces correct batch ranges', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 0;
            setLatestBlockHeight(2100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            // Fallback to 1000: [1100, 2100], [100, 1100]
            expect(ranges).toEqual([
                [1100n, 2100n],
                [100n, 1100n],
            ]);
        });

        it('150 - undefined BATCH_SIZE falls back to 1000', async () => {
            const opnet = mockConfig.OP_NET as Record<string, unknown>;
            opnet.REINDEX_BATCH_SIZE = undefined;
            setLatestBlockHeight(1100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // Fallback to 1000: range=1000, 1 batch
            expect(getBatchCount()).toBe(1);
            // Restore
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
        });
    });

    // Tests 151-153: batch logging in DEV_MODE

    describe('batch logging in DEV_MODE', () => {
        it('151 - DEV_MODE logs batch range for each iteration', async () => {
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);

            const logSpy = vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});

            await storage.revertDataUntilBlock(100n);

            // Should have log calls containing "Purging batch"
            const logCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
            const batchLogCalls = logCalls.filter((msg: string) => msg.includes('Purging batch'));
            expect(batchLogCalls.length).toBe(2); // 2 batches

            mockConfig.DEV_MODE = false;
        });

        it('152 - DEV_MODE batch log contains correct from-to values', async () => {
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);

            const logSpy = vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});

            await storage.revertDataUntilBlock(100n);

            const logCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
            const batchLogCalls = logCalls.filter((msg: string) => msg.includes('Purging batch'));
            // First batch: from=200, to=300, log says "200 - 299"
            expect(batchLogCalls[0]).toContain('200');
            expect(batchLogCalls[0]).toContain('299');
            // Second batch: from=100, to=200, log says "100 - 199"
            expect(batchLogCalls[1]).toContain('100');
            expect(batchLogCalls[1]).toContain('199');

            mockConfig.DEV_MODE = false;
        });

        it('153 - non-DEV_MODE does not log individual batch ranges', async () => {
            mockConfig.DEV_MODE = false;
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);

            const logSpy = vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});

            await storage.revertDataUntilBlock(100n);

            const logCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
            const batchLogCalls = logCalls.filter((msg: string) => msg.includes('Purging batch'));
            expect(batchLogCalls.length).toBe(0);
        });
    });

    // Tests 154-163: exact boundary verification scenarios

    describe('exact boundary verification scenarios', () => {
        it('154 - blockId=0, upperBound=BATCH_SIZE produces 1 batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(1);
            expect(getBatchRanges()[0]).toEqual([0n, 100n]);
        });

        it('155 - blockId=0, upperBound=BATCH_SIZE+1 produces 2 batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(101);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(2);
        });

        it('156 - blockId=0, upperBound=2*BATCH_SIZE produces 2 batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(2);
            expect(getBatchRanges()).toEqual([
                [100n, 200n],
                [0n, 100n],
            ]);
        });

        it('157 - blockId=BATCH_SIZE-1, upperBound=BATCH_SIZE produces 1 batch with range=1', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(100);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(99n);
            expect(getBatchCount()).toBe(1);
            expect(getBatchRanges()[0]).toEqual([99n, 100n]);
        });

        it('158 - upperBound = blockId + 1 always produces exactly 1 batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(501);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(500n);
            expect(getBatchCount()).toBe(1);
            expect(getBatchRanges()[0]).toEqual([500n, 501n]);
        });

        it('159 - upperBound determined by chainInfoHeight when it is higher', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(200);
            setChainInfoHeight(500);
            await storage.revertDataUntilBlock(100n);
            // upperBound = max(200, 500) = 500
            // range = 400, 4 batches
            expect(getBatchCount()).toBe(4);
            expect(getBatchRanges()[0][1]).toBe(500n);
        });

        it('160 - upperBound determined by blockHeaderHeight when it is higher', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(600);
            setChainInfoHeight(200);
            await storage.revertDataUntilBlock(100n);
            // upperBound = max(600, 200) = 600
            expect(getBatchRanges()[0][1]).toBe(600n);
        });

        it('161 - blockId=0 with BATCH_SIZE=1 produces N batches equal to upperBound', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1;
            setLatestBlockHeight(7);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(7);
        });

        it('162 - last batch "from" always equals blockId when range is not exact multiple', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 30;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(55n);
            const ranges = getBatchRanges();
            expect(ranges[ranges.length - 1][0]).toBe(55n);
        });

        it('163 - last batch "from" equals blockId when range is exact multiple', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            setLatestBlockHeight(200);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            const ranges = getBatchRanges();
            // range=100, 2 batches: [150,200], [100,150]
            expect(ranges[ranges.length - 1][0]).toBe(100n);
        });
    });

    // Tests 164-169: DEV_MODE vs non-DEV_MODE batch execution

    describe('DEV_MODE vs non-DEV_MODE batch execution', () => {
        beforeEach(() => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
        });

        it('164 - DEV_MODE: repos called sequentially (same batch args)', async () => {
            mockConfig.DEV_MODE = true;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);

            // Suppress log calls
            vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});

            await storage.revertDataUntilBlock(100n);

            // All repos should have been called with the same ranges
            expect(mocks.transactionRepository.deleteTransactionsInRange.mock.calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
            expect(mocks.contractRepository.deleteContractsInRange.mock.calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);

            mockConfig.DEV_MODE = false;
        });

        it('165 - non-DEV_MODE: repos called with same batch args', async () => {
            mockConfig.DEV_MODE = false;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            expect(mocks.transactionRepository.deleteTransactionsInRange.mock.calls).toEqual([
                [200n, 300n],
                [100n, 200n],
            ]);
        });

        it('166 - DEV_MODE produces same batch count as non-DEV_MODE', async () => {
            setLatestBlockHeight(400);
            setChainInfoHeight(0);

            // Run in non-DEV_MODE
            mockConfig.DEV_MODE = false;
            await storage.revertDataUntilBlock(100n);
            const nonDevCount = getBatchCount();

            // Reset mocks
            vi.clearAllMocks();
            mocks = createAllMockRepositories();
            storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            setLatestBlockHeight(400);
            setChainInfoHeight(0);

            // Run in DEV_MODE
            mockConfig.DEV_MODE = true;
            vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});
            await storage.revertDataUntilBlock(100n);
            const devCount = getBatchCount();

            expect(devCount).toBe(nonDevCount);

            mockConfig.DEV_MODE = false;
        });

        it('167 - DEV_MODE produces same batch ranges as non-DEV_MODE', async () => {
            setLatestBlockHeight(350);
            setChainInfoHeight(0);

            mockConfig.DEV_MODE = false;
            await storage.revertDataUntilBlock(100n);
            const nonDevRanges = getBatchRanges();

            vi.clearAllMocks();
            mocks = createAllMockRepositories();
            storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            setLatestBlockHeight(350);
            setChainInfoHeight(0);

            mockConfig.DEV_MODE = true;
            vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});
            await storage.revertDataUntilBlock(100n);
            const devRanges = getBatchRanges();

            expect(devRanges).toEqual(nonDevRanges);

            mockConfig.DEV_MODE = false;
        });

        it('168 - DEV_MODE calls unspentTransactionRepository in batch when purgeUtxos=true', async () => {
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);

            vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});

            await storage.revertDataUntilBlock(100n);
            expect(mocks.unspentTransactionRepository.deleteTransactionsInRange.mock.calls).toEqual(
                [
                    [200n, 300n],
                    [100n, 200n],
                ],
            );

            mockConfig.DEV_MODE = false;
        });

        it('169 - DEV_MODE skips unspentTransactionRepository in batch when purgeUtxos=false', async () => {
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);

            vi.spyOn(storage as never, 'log' as never).mockImplementation(() => {});

            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsInRange,
            ).not.toHaveBeenCalled();

            mockConfig.DEV_MODE = false;
        });
    });

    // Tests 170-172: extremely large ranges

    describe('extremely large ranges', () => {
        it('170 - range of 100_000 with BATCH_SIZE=10_000 produces 10 batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10_000;
            setLatestBlockHeight(100_000);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(10);
        });

        it('171 - range of 1_000_000 with BATCH_SIZE=100_000 produces 10 batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100_000;
            setLatestBlockHeight(1_000_000);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(10);
        });

        it('172 - large range with non-even division produces correct last batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10_000;
            setLatestBlockHeight(55_000);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);
            // range=54_900, ceil(54_900/10_000)=6 batches
            expect(getBatchCount()).toBe(6);
            const ranges = getBatchRanges();
            expect(ranges[ranges.length - 1][0]).toBe(100n);
        });
    });

    // Tests 173-175: batch interaction with first pass

    describe('batch interaction with first pass', () => {
        it('173 - first pass (FromBlockHeight) always called with upperBound regardless of batching', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);

            // First pass uses the unbounded deleteFromBlockHeight calls with upperBound
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(300n);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledWith(
                300n,
            );
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                300n,
            );
        });

        it('174 - first pass runs before any batch calls', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            setLatestBlockHeight(300);
            setChainInfoHeight(0);

            const callOrder: string[] = [];
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('firstPass');
                },
            );
            mocks.transactionRepository.deleteTransactionsInRange.mockImplementation(async () => {
                callOrder.push('batch');
            });

            await storage.revertDataUntilBlock(100n);

            expect(callOrder[0]).toBe('firstPass');
            expect(callOrder.filter((c) => c === 'batch').length).toBe(2);
        });

        it('175 - first pass call count is 1 even with multiple batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            setLatestBlockHeight(400);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(100n);

            // First pass always called once
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(1);

            // Batches: range=300, ceil(300/50)=6
            expect(getBatchCount()).toBe(6);
        });
    });

    // Tests 176-180: BATCH_SIZE from config

    describe('BATCH_SIZE from config', () => {
        it('176 - changing REINDEX_BATCH_SIZE between calls affects batch count', async () => {
            setLatestBlockHeight(1000);
            setChainInfoHeight(0);

            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(10);

            // Reset and change config
            vi.clearAllMocks();
            mocks = createAllMockRepositories();
            storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            setLatestBlockHeight(1000);
            setChainInfoHeight(0);

            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 500;
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(2);
        });

        it('177 - BATCH_SIZE=1 from config creates per-block batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1;
            setLatestBlockHeight(5);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            expect(getBatchCount()).toBe(5);
            const ranges = getBatchRanges();
            expect(ranges[0]).toEqual([4n, 5n]);
            expect(ranges[4]).toEqual([0n, 1n]);
        });

        it('178 - BATCH_SIZE read from Config.OP_NET.REINDEX_BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 250;
            setLatestBlockHeight(1000);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            // range=1000, 1000/250=4 batches
            expect(getBatchCount()).toBe(4);
        });

        it('179 - BATCH_SIZE=2 with range=3 produces 2 batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 2;
            setLatestBlockHeight(3);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            // range=3, first batch: from=1, to=3; second batch: from=0, to=1
            expect(getBatchCount()).toBe(2);
            expect(getBatchRanges()).toEqual([
                [1n, 3n],
                [0n, 1n],
            ]);
        });

        it('180 - BATCH_SIZE=3 with range=7 produces 3 batches', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 3;
            setLatestBlockHeight(7);
            setChainInfoHeight(0);
            await storage.revertDataUntilBlock(0n);
            // range=7
            // batch 1: to=7, from=max(4, 0)=4 => [4, 7]
            // batch 2: to=4, from=max(1, 0)=1 => [1, 4]
            // batch 3: to=1, from=max(-2, 0)=0 => [0, 1]
            expect(getBatchCount()).toBe(3);
            expect(getBatchRanges()).toEqual([
                [4n, 7n],
                [1n, 4n],
                [0n, 1n],
            ]);
        });
    });
});
