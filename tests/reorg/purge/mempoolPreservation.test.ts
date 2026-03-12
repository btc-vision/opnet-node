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

describe('Mempool Preservation During Reorg', () => {
    let storage: VMMongoStorage;
    let mocks: AllMockRepositories;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConfig.DEV_MODE = false;
        mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
        mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;

        mocks = createAllMockRepositories();
        storage = createMockVMMongoStorage(mockConfig);
        injectMockRepositories(storage, mocks);
        mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
        mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
            inProgressBlock: 500,
        });
    });

    // -------------------------------------------------------------------
    // revertDataUntilBlock mempool behavior
    // -------------------------------------------------------------------

    describe('revertDataUntilBlock mempool behavior', () => {
        it('should NOT touch mempool when reverting to blockId > 0 (normal reorg)', async () => {
            await storage.revertDataUntilBlock(100n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should NOT touch mempool when reverting to blockId = 1n', async () => {
            await storage.revertDataUntilBlock(1n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should NOT touch mempool when reverting to blockId = 100n', async () => {
            await storage.revertDataUntilBlock(100n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should NOT touch mempool when reverting to blockId = 999999n', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '1000000' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1000000,
            });

            await storage.revertDataUntilBlock(999999n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should purge mempool when blockId = 0n (full reindex)', async () => {
            await storage.revertDataUntilBlock(0n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledOnce();
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
        });

        it('should purge mempool when blockId = -1n', async () => {
            await storage.revertDataUntilBlock(-1n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledOnce();
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(-1n);
        });

        it('should call deleteGreaterThanBlockHeight(0n) when blockId = 0n', async () => {
            await storage.revertDataUntilBlock(0n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
        });

        it('should call deleteGreaterThanBlockHeight(-1n) when blockId = -1n', async () => {
            await storage.revertDataUntilBlock(-1n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(-1n);
        });

        it('should purge UTXOs alongside mempool when blockId <= 0n and purgeUtxos = true', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;

            await storage.revertDataUntilBlock(0n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).toHaveBeenCalledWith(0n);
        });

        it('should NOT purge UTXOs when blockId <= 0n and purgeUtxos = false', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;

            await storage.revertDataUntilBlock(0n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).not.toHaveBeenCalled();
        });

        it('should purge mempool AFTER all batched deletes complete', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            const callOrder: string[] = [];

            mocks.transactionRepository.deleteTransactionsInRange.mockImplementation(async () => {
                callOrder.push('batchDelete');
            });
            mocks.mempoolRepository.deleteGreaterThanBlockHeight.mockImplementation(async () => {
                callOrder.push('mempoolPurge');
            });

            await storage.revertDataUntilBlock(0n);

            // All batch deletes should come before mempool purge
            const mempoolIndex = callOrder.indexOf('mempoolPurge');
            const lastBatchIndex = callOrder.lastIndexOf('batchDelete');

            expect(mempoolIndex).toBeGreaterThan(-1);
            expect(lastBatchIndex).toBeGreaterThan(-1);
            expect(mempoolIndex).toBeGreaterThan(lastBatchIndex);
        });
    });

    // -------------------------------------------------------------------
    // mempool isolation during batched pass
    // -------------------------------------------------------------------

    describe('mempool isolation during batched pass', () => {
        it('should complete all batch iterations without touching mempool when blockId > 0', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '1000' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1000,
            });

            await storage.revertDataUntilBlock(500n);

            // Should have done multiple batches (1000 - 500 = 500 range, batch size 100 = 5 batches)
            expect(mocks.transactionRepository.deleteTransactionsInRange.mock.calls.length).toBe(5);
            // Mempool should be completely untouched
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should execute target epoch delete, first pass, batched pass, then mempool check', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 500;
            const callOrder: string[] = [];

            mocks.targetEpochRepository.deleteAllTargetEpochs.mockImplementation(async () => {
                callOrder.push('targetEpochs');
            });
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('firstPass');
                },
            );
            mocks.transactionRepository.deleteTransactionsInRange.mockImplementation(async () => {
                callOrder.push('batchedPass');
            });
            mocks.mempoolRepository.deleteGreaterThanBlockHeight.mockImplementation(async () => {
                callOrder.push('mempoolCheck');
            });

            await storage.revertDataUntilBlock(0n);

            expect(callOrder.indexOf('targetEpochs')).toBeLessThan(callOrder.indexOf('firstPass'));
            expect(callOrder.indexOf('firstPass')).toBeLessThan(callOrder.indexOf('batchedPass'));
            expect(callOrder.indexOf('batchedPass')).toBeLessThan(
                callOrder.indexOf('mempoolCheck'),
            );
        });

        it('should not call any mempool methods during first pass', async () => {
            // Use DEV_MODE to get sequential execution (easier to track ordering)
            mockConfig.DEV_MODE = true;
            const callOrder: string[] = [];

            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('firstPass:transaction');
                    // At this point, mempool should not have been called
                    expect(
                        mocks.mempoolRepository.deleteGreaterThanBlockHeight,
                    ).not.toHaveBeenCalled();
                },
            );
            mocks.contractRepository.deleteContractsFromBlockHeight.mockImplementation(async () => {
                callOrder.push('firstPass:contract');
                expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
            });

            await storage.revertDataUntilBlock(50n);

            expect(callOrder.length).toBeGreaterThan(0);
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should not call any mempool methods during batched pass', async () => {
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 100;

            mocks.transactionRepository.deleteTransactionsInRange.mockImplementation(async () => {
                // During each batch iteration, mempool should not have been called
                expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
            });

            await storage.revertDataUntilBlock(200n);

            // Verify batches actually ran
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
            // And mempool was never touched (blockId > 0)
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------
    // revertBlockHeadersOnly never touches mempool
    // -------------------------------------------------------------------

    describe('revertBlockHeadersOnly never touches mempool', () => {
        it('should not call mempoolRepository for any operation', async () => {
            await storage.revertBlockHeadersOnly(100n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should not call deleteGreaterThanBlockHeight', async () => {
            // Even with blockId = 0, revertBlockHeadersOnly should never touch mempool
            await storage.revertBlockHeadersOnly(0n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------
    // mempool state preservation across reorg scenarios
    // -------------------------------------------------------------------

    describe('mempool state preservation across reorg scenarios', () => {
        it('should preserve mempool when reverting 1 block (blockId = latestBlock - 1)', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            // Revert just one block: from 500 to 499
            await storage.revertDataUntilBlock(499n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
            // But other repos should have been purged
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalled();
        });

        it('should preserve mempool when reverting 100 blocks', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            // Revert 100 blocks: from 500 to 400
            await storage.revertDataUntilBlock(400n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
            // Transaction batched pass should have run
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
        });

        it('should preserve mempool even when all other data is purged', async () => {
            // Revert to block 1 (everything but genesis is purged)
            // blockId=1 is > 0 so mempool should still be preserved
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '10000' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 10000,
            });

            await storage.revertDataUntilBlock(1n);

            // All data repos should have been aggressively purged
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalled();
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
            expect(mocks.contractRepository.deleteContractsInRange).toHaveBeenCalled();
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalled();
            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalled();
            // But mempool must be untouched — blockId=1 > 0
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });
    });
});
