import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllMockRepositories, createAllMockRepositories } from '../mocks/mockRepositories.js';
import { createMockVMMongoStorage, injectMockRepositories } from '../mocks/mockVMStorage.js';
import { VMMongoStorage } from '../../../src/src/vm/storage/databases/VMMongoStorage.js';

// Use vi.hoisted so the config object is available when vi.mock factory runs.
const mockConfig = vi.hoisted(() => ({
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
}));

vi.mock('../../../src/src/config/Config.js', () => ({
    Config: mockConfig,
}));

describe('VMMongoStorage.revertBlockHeadersOnly', () => {
    let storage: VMMongoStorage;
    let mocks: AllMockRepositories;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;

        mocks = createAllMockRepositories();
        storage = createMockVMMongoStorage(mockConfig);
        injectMockRepositories(storage, mocks);

        // Default: latestBlock at height 100
        mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
    });

    /** Tests 331-343 (merged): Basic functionality */

    describe('basic functionality', () => {
        it('should call blockRepository.deleteBlockHeadersInRange', async () => {
            await storage.revertBlockHeadersOnly(50n);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalled();
        });

        it('should call blockWitnessRepository.deleteBlockWitnessesInRange', async () => {
            await storage.revertBlockHeadersOnly(50n);
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).toHaveBeenCalled();
        });

        it('should call getLatestBlock to determine upper bound', async () => {
            await storage.revertBlockHeadersOnly(50n);
            expect(mocks.blockRepository.getLatestBlock).toHaveBeenCalledOnce();
        });

        it('should NOT call any non-block-header repositories', async () => {
            await storage.revertBlockHeadersOnly(50n);

            // transactionRepository
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();

            // unspentTransactionRepository
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsInRange,
            ).not.toHaveBeenCalled();
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).not.toHaveBeenCalled();

            // contractRepository
            expect(mocks.contractRepository.deleteContractsInRange).not.toHaveBeenCalled();
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).not.toHaveBeenCalled();

            // pointerRepository
            expect(mocks.pointerRepository.deletePointerInRange).not.toHaveBeenCalled();
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).not.toHaveBeenCalled();

            // reorgRepository
            expect(mocks.reorgRepository.deleteReorgsInRange).not.toHaveBeenCalled();
            expect(mocks.reorgRepository.deleteReorgs).not.toHaveBeenCalled();

            // epochRepository
            expect(mocks.epochRepository.deleteEpochInRange).not.toHaveBeenCalled();
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).not.toHaveBeenCalled();

            // epochSubmissionRepository
            expect(mocks.epochSubmissionRepository.deleteSubmissionsInRange).not.toHaveBeenCalled();
            expect(
                mocks.epochSubmissionRepository.deleteSubmissionsFromBlock,
            ).not.toHaveBeenCalled();

            // mldsaPublicKeysRepository
            expect(mocks.mldsaPublicKeysRepository.deleteInRange).not.toHaveBeenCalled();
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).not.toHaveBeenCalled();

            // mempoolRepository
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();

            // blockchainInfoRepository
            expect(mocks.blockchainInfoRepository.getByNetwork).not.toHaveBeenCalled();
            expect(
                mocks.blockchainInfoRepository.updateCurrentBlockInProgress,
            ).not.toHaveBeenCalled();
        });
    });

    /** Tests 344-348: Batch direction (walks UP from blockId to upperBound) */

    describe('batch direction', () => {
        it('344: should walk UP from blockId when blockId < upperBound', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '50' });

            await storage.revertBlockHeadersOnly(20n);

            const calls = mocks.blockRepository.deleteBlockHeadersInRange.mock.calls;
            expect(calls.length).toBeGreaterThanOrEqual(2);

            // First batch starts at blockId
            expect(calls[0][0]).toBe(20n);
            // Second batch starts at blockId + BATCH_SIZE
            expect(calls[1][0]).toBe(30n);
        });

        it('345: should increment "from" by BATCH_SIZE each iteration', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 5;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '25' });

            await storage.revertBlockHeadersOnly(10n);

            const calls = mocks.blockRepository.deleteBlockHeadersInRange.mock.calls;
            // from=10 to=15, from=15 to=20, from=20 to=25, from=25 to=30
            expect(calls.length).toBe(4);
            expect(calls[0][0]).toBe(10n);
            expect(calls[1][0]).toBe(15n);
            expect(calls[2][0]).toBe(20n);
            expect(calls[3][0]).toBe(25n);
        });

        it('346: should pass "from + BATCH_SIZE" as the "to" parameter', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '30' });

            await storage.revertBlockHeadersOnly(10n);

            const calls = mocks.blockRepository.deleteBlockHeadersInRange.mock.calls;
            // First batch: from=10, to=20
            expect(calls[0][0]).toBe(10n);
            expect(calls[0][1]).toBe(20n);
            // Second batch: from=20, to=30
            expect(calls[1][0]).toBe(20n);
            expect(calls[1][1]).toBe(30n);
        });

        it('347: should call both repos with same from/to in each batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '25' });

            await storage.revertBlockHeadersOnly(10n);

            const blockCalls = mocks.blockRepository.deleteBlockHeadersInRange.mock.calls;
            const witnessCalls =
                mocks.blockWitnessRepository.deleteBlockWitnessesInRange.mock.calls;

            expect(blockCalls.length).toBe(witnessCalls.length);
            for (let i = 0; i < blockCalls.length; i++) {
                expect(blockCalls[i][0]).toBe(witnessCalls[i][0]);
                expect(blockCalls[i][1]).toBe(witnessCalls[i][1]);
            }
        });

        it('348: should stop iterating once "from" exceeds upperBound', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '15' });

            await storage.revertBlockHeadersOnly(10n);

            // from=10 (<=15 OK), from=20 (>15 STOP)
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
        });
    });

    /** Tests 349-352 (merged): Upper bound calculation */

    describe('upper bound calculation', () => {
        it('should use latestBlock.height as upperBound when latestBlock exists', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 5000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '200' });

            await storage.revertBlockHeadersOnly(100n);

            // With BATCH_SIZE=5000 and range 100..200, only one batch: from=100, to=5100
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(
                100n,
                5100n,
            );
        });

        it('should use blockId as upperBound when getLatestBlock returns null or undefined, and NOT use blockchainInfoRepository', async () => {
            // null case
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue(null);

            await storage.revertBlockHeadersOnly(50n);

            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(
                50n,
                1050n,
            );

            // undefined case
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);

            await storage.revertBlockHeadersOnly(75n);

            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(
                75n,
                1075n,
            );

            // blockchainInfoRepository should never be consulted
            expect(mocks.blockchainInfoRepository.getByNetwork).not.toHaveBeenCalled();
        });
    });

    /** Tests 353-357: Batch sizes */

    describe('batch sizes', () => {
        it('353: should use REINDEX_BATCH_SIZE from config', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 25;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });

            await storage.revertBlockHeadersOnly(50n);

            const calls = mocks.blockRepository.deleteBlockHeadersInRange.mock.calls;
            // from=50,to=75; from=75,to=100; from=100,to=125
            expect(calls.length).toBe(3);
            expect(calls[0][0]).toBe(50n);
            expect(calls[0][1]).toBe(75n);
            expect(calls[1][0]).toBe(75n);
            expect(calls[1][1]).toBe(100n);
            expect(calls[2][0]).toBe(100n);
            expect(calls[2][1]).toBe(125n);
        });

        it('354: should default to 1000 when REINDEX_BATCH_SIZE is 0', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 0;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });

            await storage.revertBlockHeadersOnly(0n);

            // Default BATCH_SIZE = 1000, range 0..500 fits in one batch
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(0n, 1000n);
        });

        it('355: should handle large batch size that covers entire range in one call', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });

            await storage.revertBlockHeadersOnly(50n);

            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).toHaveBeenCalledTimes(
                1,
            );
        });

        it('356: should handle batch size of 1 (one block per batch)', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '5' });

            await storage.revertBlockHeadersOnly(3n);

            // from=3 (<=5), from=4 (<=5), from=5 (<=5), from=6 (>5 stop)
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(3);
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).toHaveBeenCalledTimes(
                3,
            );
        });

        it('357: should produce correct number of batches for exact multiple', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '40' });

            await storage.revertBlockHeadersOnly(10n);

            // from=10,to=20; from=20,to=30; from=30,to=40; from=40,to=50
            // 10<=40, 20<=40, 30<=40, 40<=40, 50>40 stop => 4 batches
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(4);
        });
    });

    /** Tests 358-362: Edge cases */

    describe('edge cases', () => {
        it('358: should handle blockId equal to upperBound (single batch)', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '50' });

            await storage.revertBlockHeadersOnly(50n);

            // from=50 (<=50 OK), single batch
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(
                50n,
                1050n,
            );
        });

        it('359: should handle blockId of 0n', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });

            await storage.revertBlockHeadersOnly(0n);

            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(0n, 1000n);
        });

        it('360: should handle blockId greater than upperBound (no batches executed)', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '50' });

            await storage.revertBlockHeadersOnly(100n);

            // from=100 > upperBound=50, loop does not execute
            expect(mocks.blockRepository.deleteBlockHeadersInRange).not.toHaveBeenCalled();
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).not.toHaveBeenCalled();
        });

        it('361: should handle very large block heights', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            const largeBlock = 999_999_999n;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: largeBlock.toString(),
            });

            await storage.revertBlockHeadersOnly(largeBlock);

            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(
                largeBlock,
                largeBlock + 1000n,
            );
        });

        it('362: should resolve successfully when no errors occur', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });

            await expect(storage.revertBlockHeadersOnly(50n)).resolves.toBeUndefined();
        });
    });

    /** Tests 363-367: Error handling */

    describe('error handling', () => {
        it('363: should throw when blockRepository is not initialized', async () => {
            const s = storage as Record<string, unknown>;
            s.blockRepository = undefined;

            await expect(storage.revertBlockHeadersOnly(50n)).rejects.toThrow(
                'Block header repository not initialized',
            );
        });

        it('364: should throw when blockWitnessRepository is not initialized', async () => {
            const s = storage as Record<string, unknown>;
            s.blockWitnessRepository = undefined;

            await expect(storage.revertBlockHeadersOnly(50n)).rejects.toThrow(
                'Block witness repository not initialized',
            );
        });

        it('365: should throw when blockRepository is null', async () => {
            const s = storage as Record<string, unknown>;
            s.blockRepository = null;

            await expect(storage.revertBlockHeadersOnly(50n)).rejects.toThrow(
                'Block header repository not initialized',
            );
        });

        it('366: should propagate error from deleteBlockHeadersInRange', async () => {
            mocks.blockRepository.deleteBlockHeadersInRange.mockRejectedValue(
                new Error('DB write failed'),
            );

            await expect(storage.revertBlockHeadersOnly(50n)).rejects.toThrow('DB write failed');
        });

        it('367: should propagate error from deleteBlockWitnessesInRange', async () => {
            mocks.blockWitnessRepository.deleteBlockWitnessesInRange.mockRejectedValue(
                new Error('Witness delete failed'),
            );

            await expect(storage.revertBlockHeadersOnly(50n)).rejects.toThrow(
                'Witness delete failed',
            );
        });
    });

    /** Tests 368-370 (merged): Logging */

    describe('logging', () => {
        it('should log warning at start, progress per batch, and info after completion', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '30' });

            const warnSpy = vi.spyOn(storage as never, 'warn' as never);
            const infoSpy = vi.spyOn(storage as never, 'info' as never);
            const logSpy = vi.spyOn(storage as never, 'log' as never);

            await storage.revertBlockHeadersOnly(10n);

            // Warning at start
            expect(warnSpy).toHaveBeenCalledWith(
                'RESYNC: Purging only block headers and witnesses from block 10',
            );

            // Info after completion
            expect(infoSpy).toHaveBeenCalledWith(
                'Block headers and witnesses purged from block 10',
            );

            // Progress per batch
            expect(logSpy).toHaveBeenCalledWith('Purging block headers 10 - 20...');
            expect(logSpy).toHaveBeenCalledWith('Purging block headers 20 - 30...');
            expect(logSpy).toHaveBeenCalledWith('Purging block headers 30 - 30...');
        });
    });
});
