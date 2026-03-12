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

describe('VMMongoStorage.revertDataUntilBlock() - Basic Tests', () => {
    let storage: VMMongoStorage;
    let mocks: AllMockRepositories;

    beforeEach(() => {
        vi.restoreAllMocks();

        // Reset config to defaults
        mockConfig.DEV_MODE = false;
        mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
        mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
        mockConfig.BITCOIN.NETWORK = 'regtest';

        mocks = createAllMockRepositories();
        storage = createMockVMMongoStorage(mockConfig);
        injectMockRepositories(storage, mocks);

        // Defaults: no latest block, chain info at 0
        mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
        mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
    });

    // =========================================================================
    // Repository invocation with standard blockId
    // =========================================================================
    describe('repository invocation with standard blockId', () => {
        it('should call all first-pass unbounded delete methods with upperBound', async () => {
            await storage.revertDataUntilBlock(500n);

            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalledTimes(1);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledWith(
                500n,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledWith(500n);
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                500n,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledWith(500n);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledWith(500n);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledWith(
                500n,
            );
            expect(mocks.epochSubmissionRepository.deleteSubmissionsFromBlock).toHaveBeenCalledWith(
                500n,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                500n,
            );
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
        });

        it('should call all batched range-delete methods with correct arguments', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
            await storage.revertDataUntilBlock(500n);

            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                500n,
                1000n,
            );
            expect(mocks.contractRepository.deleteContractsInRange).toHaveBeenCalledWith(
                500n,
                1000n,
            );
            expect(mocks.pointerRepository.deletePointerInRange).toHaveBeenCalledWith(500n, 1000n);
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(
                500n,
                1000n,
            );
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).toHaveBeenCalledWith(
                500n,
                1000n,
            );
            expect(mocks.reorgRepository.deleteReorgsInRange).toHaveBeenCalledWith(500n, 1000n);
            expect(mocks.epochRepository.deleteEpochInRange).toHaveBeenCalledWith(500n, 1000n);
            expect(mocks.epochSubmissionRepository.deleteSubmissionsInRange).toHaveBeenCalledWith(
                500n,
                1000n,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteInRange).toHaveBeenCalledWith(500n, 1000n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsInRange,
            ).toHaveBeenCalledWith(500n, 1000n);
        });

        it('should derive upperBound from the highest of blockId, latestBlock, and chainInfo', async () => {
            // blockId as upperBound (no latestBlock, chainInfo=0)
            await storage.revertDataUntilBlock(500n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
            expect(mocks.blockRepository.getLatestBlock).toHaveBeenCalledTimes(1);
            expect(mocks.blockchainInfoRepository.getByNetwork).toHaveBeenCalledWith('regtest');

            vi.clearAllMocks();

            // blockHeaderHeight as upperBound
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '2000' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1500,
            });
            await storage.revertDataUntilBlock(500n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(2000n);

            vi.clearAllMocks();

            // chainInfoHeight as upperBound
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 3000,
            });
            await storage.revertDataUntilBlock(500n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(3000n);
        });

        it('should not perform batched pass when upperBound equals blockId', async () => {
            await storage.revertDataUntilBlock(500n);
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // purgeUtxos configuration
    // =========================================================================
    describe('purgeUtxos configuration', () => {
        it('should gate UTXO first-pass and batched-pass deletes on purgeUtxos setting', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            await storage.revertDataUntilBlock(500n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalled();
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsInRange,
            ).toHaveBeenCalledWith(500n, 1000n);

            vi.clearAllMocks();

            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            await storage.revertDataUntilBlock(500n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsInRange,
            ).not.toHaveBeenCalled();

            // All other repos should still be called
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalled();
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalled();
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalled();
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalled();
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight).toHaveBeenCalled();
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalled();
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalled();
            expect(mocks.epochSubmissionRepository.deleteSubmissionsFromBlock).toHaveBeenCalled();
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalled();
        });

        it('should gate UTXO deleteGreaterThanBlockHeight at blockId 0n on purgeUtxos setting', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            await storage.revertDataUntilBlock(0n);
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).toHaveBeenCalledWith(0n);

            vi.clearAllMocks();

            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            await storage.revertDataUntilBlock(0n);
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // DEV_MODE sequential vs parallel execution
    // =========================================================================
    describe('DEV_MODE sequential vs parallel execution', () => {
        it('should call repos in correct sequential order in DEV_MODE first pass (with utxos)', async () => {
            mockConfig.DEV_MODE = true;
            const callOrder: string[] = [];

            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('transactions');
                },
            );
            mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('utxos');
                },
            );
            mocks.contractRepository.deleteContractsFromBlockHeight.mockImplementation(async () => {
                callOrder.push('contracts');
            });
            mocks.pointerRepository.deletePointerFromBlockHeight.mockImplementation(async () => {
                callOrder.push('pointers');
            });
            mocks.blockRepository.deleteBlockHeadersFromBlockHeight.mockImplementation(async () => {
                callOrder.push('blocks');
            });
            mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight.mockImplementation(
                async () => {
                    callOrder.push('witnesses');
                },
            );
            mocks.reorgRepository.deleteReorgs.mockImplementation(async () => {
                callOrder.push('reorgs');
            });
            mocks.epochRepository.deleteEpochFromBitcoinBlockNumber.mockImplementation(async () => {
                callOrder.push('epochs');
            });
            mocks.epochSubmissionRepository.deleteSubmissionsFromBlock.mockImplementation(
                async () => {
                    callOrder.push('submissions');
                },
            );
            mocks.mldsaPublicKeysRepository.deleteFromBlockHeight.mockImplementation(async () => {
                callOrder.push('mldsa');
            });

            await storage.revertDataUntilBlock(500n);

            expect(callOrder).toEqual([
                'transactions',
                'utxos',
                'contracts',
                'pointers',
                'blocks',
                'witnesses',
                'reorgs',
                'epochs',
                'submissions',
                'mldsa',
            ]);
        });

        it('should call repos in correct sequential order in DEV_MODE first pass (without utxos)', async () => {
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            const callOrder: string[] = [];

            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('transactions');
                },
            );
            mocks.contractRepository.deleteContractsFromBlockHeight.mockImplementation(async () => {
                callOrder.push('contracts');
            });
            mocks.pointerRepository.deletePointerFromBlockHeight.mockImplementation(async () => {
                callOrder.push('pointers');
            });
            mocks.blockRepository.deleteBlockHeadersFromBlockHeight.mockImplementation(async () => {
                callOrder.push('blocks');
            });
            mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight.mockImplementation(
                async () => {
                    callOrder.push('witnesses');
                },
            );
            mocks.reorgRepository.deleteReorgs.mockImplementation(async () => {
                callOrder.push('reorgs');
            });
            mocks.epochRepository.deleteEpochFromBitcoinBlockNumber.mockImplementation(async () => {
                callOrder.push('epochs');
            });
            mocks.epochSubmissionRepository.deleteSubmissionsFromBlock.mockImplementation(
                async () => {
                    callOrder.push('submissions');
                },
            );
            mocks.mldsaPublicKeysRepository.deleteFromBlockHeight.mockImplementation(async () => {
                callOrder.push('mldsa');
            });

            await storage.revertDataUntilBlock(500n);

            expect(callOrder).toEqual([
                'transactions',
                'contracts',
                'pointers',
                'blocks',
                'witnesses',
                'reorgs',
                'epochs',
                'submissions',
                'mldsa',
            ]);
        });

        it('should call repos in correct sequential order in DEV_MODE batched pass (transactions first, mldsa last)', async () => {
            mockConfig.DEV_MODE = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            const callOrder: string[] = [];

            mocks.transactionRepository.deleteTransactionsInRange.mockImplementation(async () => {
                callOrder.push('transactions-range');
            });
            mocks.unspentTransactionRepository.deleteTransactionsInRange.mockImplementation(
                async () => {
                    callOrder.push('utxos-range');
                },
            );
            mocks.contractRepository.deleteContractsInRange.mockImplementation(async () => {
                callOrder.push('contracts-range');
            });
            mocks.pointerRepository.deletePointerInRange.mockImplementation(async () => {
                callOrder.push('pointers-range');
            });
            mocks.blockRepository.deleteBlockHeadersInRange.mockImplementation(async () => {
                callOrder.push('blocks-range');
            });
            mocks.blockWitnessRepository.deleteBlockWitnessesInRange.mockImplementation(
                async () => {
                    callOrder.push('witnesses-range');
                },
            );
            mocks.reorgRepository.deleteReorgsInRange.mockImplementation(async () => {
                callOrder.push('reorgs-range');
            });
            mocks.epochRepository.deleteEpochInRange.mockImplementation(async () => {
                callOrder.push('epochs-range');
            });
            mocks.epochSubmissionRepository.deleteSubmissionsInRange.mockImplementation(
                async () => {
                    callOrder.push('submissions-range');
                },
            );
            mocks.mldsaPublicKeysRepository.deleteInRange.mockImplementation(async () => {
                callOrder.push('mldsa-range');
            });

            await storage.revertDataUntilBlock(500n);

            expect(callOrder[0]).toBe('transactions-range');
            expect(callOrder[callOrder.length - 1]).toBe('mldsa-range');
        });

        it('should use Promise.safeAll correctly based on DEV_MODE and pass correct promise counts', async () => {
            // DEV_MODE = true: no safeAll (first pass only)
            mockConfig.DEV_MODE = true;
            const safeAllSpy1 = vi.spyOn(Promise, 'safeAll');
            await storage.revertDataUntilBlock(500n);
            expect(safeAllSpy1).not.toHaveBeenCalled();

            vi.restoreAllMocks();
            vi.clearAllMocks();

            // DEV_MODE = true with batched pass: still no safeAll
            mockConfig.DEV_MODE = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            const safeAllSpy2 = vi.spyOn(Promise, 'safeAll');
            await storage.revertDataUntilBlock(500n);
            expect(safeAllSpy2).not.toHaveBeenCalled();

            vi.restoreAllMocks();
            vi.clearAllMocks();

            // DEV_MODE = false, purgeUtxos=true: 10 promises in first pass
            mockConfig.DEV_MODE = false;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
            const safeAllSpy3 = vi.spyOn(Promise, 'safeAll');
            await storage.revertDataUntilBlock(500n);
            expect(safeAllSpy3).toHaveBeenCalled();
            const firstCallArgs = safeAllSpy3.mock.calls[0][0] as unknown[];
            expect(firstCallArgs).toHaveLength(10);

            vi.restoreAllMocks();
            vi.clearAllMocks();

            // DEV_MODE = false with batched pass: 2 safeAll calls, 10 promises each
            mockConfig.DEV_MODE = false;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
            const safeAllSpy4 = vi.spyOn(Promise, 'safeAll');
            await storage.revertDataUntilBlock(500n);
            expect(safeAllSpy4).toHaveBeenCalledTimes(2);
            const batchCallArgs = safeAllSpy4.mock.calls[1][0] as unknown[];
            expect(batchCallArgs).toHaveLength(10);

            vi.restoreAllMocks();
            vi.clearAllMocks();

            // purgeUtxos=false: 9 promises instead of 10
            mockConfig.DEV_MODE = false;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
            const safeAllSpy5 = vi.spyOn(Promise, 'safeAll');
            await storage.revertDataUntilBlock(500n);
            const firstCallArgs2 = safeAllSpy5.mock.calls[0][0] as unknown[];
            expect(firstCallArgs2).toHaveLength(9);
            const batchCallArgs2 = safeAllSpy5.mock.calls[1][0] as unknown[];
            expect(batchCallArgs2).toHaveLength(9);
        });
    });

    // =========================================================================
    // blockId <= 0n triggers mempool purge
    // =========================================================================
    describe('blockId <= 0n triggers mempool purge', () => {
        it('should call mempoolRepository.deleteGreaterThanBlockHeight when blockId is 0n', async () => {
            await storage.revertDataUntilBlock(0n);
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
        });

        it('should call mempoolRepository.deleteGreaterThanBlockHeight when blockId is -1n', async () => {
            await storage.revertDataUntilBlock(-1n);
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(-1n);
        });

        it('should NOT call mempoolRepository.deleteGreaterThanBlockHeight when blockId is 1n', async () => {
            await storage.revertDataUntilBlock(1n);
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('should call unspent deleteGreaterThanBlockHeight when blockId=0n and purgeUtxos=true', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            await storage.revertDataUntilBlock(0n);
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).toHaveBeenCalledWith(0n);
        });

        it('should NOT call unspent deleteGreaterThanBlockHeight when blockId=0n and purgeUtxos=false', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            await storage.revertDataUntilBlock(0n);
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).not.toHaveBeenCalled();
        });

        it('should NOT call mempoolRepository.deleteGreaterThanBlockHeight when blockId is 100n', async () => {
            await storage.revertDataUntilBlock(100n);
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // blockId edge values
    // =========================================================================
    describe('blockId edge values', () => {
        it('should handle blockId = 0n successfully', async () => {
            await expect(storage.revertDataUntilBlock(0n)).resolves.toBeUndefined();
        });

        it('should handle blockId = 1n successfully', async () => {
            await expect(storage.revertDataUntilBlock(1n)).resolves.toBeUndefined();
        });

        it('should handle very large blockId', async () => {
            await expect(storage.revertDataUntilBlock(999_999_999n)).resolves.toBeUndefined();
        });

        it('should handle negative blockId', async () => {
            await expect(storage.revertDataUntilBlock(-10n)).resolves.toBeUndefined();
        });

        it('should use blockId as upperBound when blockId > blockHeaderHeight and chainInfoHeight', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 50 });
            await storage.revertDataUntilBlock(500n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
        });

        it('should handle blockId equal to latestBlock height (no batched pass)', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '500' },
            });
            await storage.revertDataUntilBlock(500n);
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // target epochs always deleted
    // =========================================================================
    describe('target epochs always deleted', () => {
        it('should always call deleteAllTargetEpochs with no arguments before first pass repos', async () => {
            mockConfig.DEV_MODE = true;
            const callOrder: string[] = [];

            mocks.targetEpochRepository.deleteAllTargetEpochs.mockImplementation(async () => {
                callOrder.push('targetEpochs');
            });
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('transactions');
                },
            );

            await storage.revertDataUntilBlock(500n);
            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalledTimes(1);
            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalledWith();
            expect(callOrder.indexOf('targetEpochs')).toBeLessThan(
                callOrder.indexOf('transactions'),
            );

            vi.clearAllMocks();
            callOrder.length = 0;

            mocks.targetEpochRepository.deleteAllTargetEpochs.mockImplementation(async () => {
                callOrder.push('targetEpochs');
            });

            // Also works with blockId=0n
            await storage.revertDataUntilBlock(0n);
            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalledTimes(1);
        });
    });

    // =========================================================================
    // method call order
    // =========================================================================
    describe('method call order', () => {
        it('should call getLatestBlock and getByNetwork before any delete operations', async () => {
            mockConfig.DEV_MODE = true;
            const callOrder: string[] = [];

            mocks.blockRepository.getLatestBlock.mockImplementation(async () => {
                callOrder.push('getLatestBlock');
                return undefined;
            });
            mocks.blockchainInfoRepository.getByNetwork.mockImplementation(async () => {
                callOrder.push('getByNetwork');
                return { inProgressBlock: 0 };
            });
            mocks.targetEpochRepository.deleteAllTargetEpochs.mockImplementation(async () => {
                callOrder.push('deleteTargetEpochs');
            });
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('deleteTransactions');
                },
            );

            await storage.revertDataUntilBlock(500n);
            expect(callOrder.indexOf('getLatestBlock')).toBeLessThan(
                callOrder.indexOf('deleteTargetEpochs'),
            );
            expect(callOrder.indexOf('getByNetwork')).toBeLessThan(
                callOrder.indexOf('deleteTargetEpochs'),
            );
        });

        it('should execute first pass before batched pass', async () => {
            mockConfig.DEV_MODE = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            const callOrder: string[] = [];

            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('firstPass');
                },
            );
            mocks.transactionRepository.deleteTransactionsInRange.mockImplementation(async () => {
                callOrder.push('batchedPass');
            });

            await storage.revertDataUntilBlock(500n);
            expect(callOrder.indexOf('firstPass')).toBeLessThan(callOrder.indexOf('batchedPass'));
        });

        it('should execute batched pass before mempool purge (blockId=0n)', async () => {
            mockConfig.DEV_MODE = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            const callOrder: string[] = [];

            mocks.transactionRepository.deleteTransactionsInRange.mockImplementation(async () => {
                callOrder.push('batchedPass');
            });
            mocks.mempoolRepository.deleteGreaterThanBlockHeight.mockImplementation(async () => {
                callOrder.push('mempoolPurge');
            });

            await storage.revertDataUntilBlock(0n);
            expect(callOrder.indexOf('batchedPass')).toBeLessThan(
                callOrder.indexOf('mempoolPurge'),
            );
        });

        it('overall order: getLatestBlock -> getByNetwork -> targetEpochs -> firstPass -> batchedPass -> mempool', async () => {
            mockConfig.DEV_MODE = true;
            const callOrder: string[] = [];

            mocks.blockRepository.getLatestBlock.mockImplementation(async () => {
                callOrder.push('getLatestBlock');
                return { height: { toString: () => '1000' } };
            });
            mocks.blockchainInfoRepository.getByNetwork.mockImplementation(async () => {
                callOrder.push('getByNetwork');
                return { inProgressBlock: 0 };
            });
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
                callOrder.push('mempoolPurge');
            });

            await storage.revertDataUntilBlock(0n);

            expect(callOrder.indexOf('getLatestBlock')).toBeLessThan(
                callOrder.indexOf('getByNetwork'),
            );
            expect(callOrder.indexOf('getByNetwork')).toBeLessThan(
                callOrder.indexOf('targetEpochs'),
            );
            expect(callOrder.indexOf('targetEpochs')).toBeLessThan(callOrder.indexOf('firstPass'));
            expect(callOrder.indexOf('firstPass')).toBeLessThan(callOrder.indexOf('batchedPass'));
            expect(callOrder.indexOf('batchedPass')).toBeLessThan(
                callOrder.indexOf('mempoolPurge'),
            );
        });
    });

    // =========================================================================
    // argument correctness
    // =========================================================================
    describe('argument correctness', () => {
        it('should pass correct arguments to first-pass and batched methods based on upperBound', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '2000' },
            });
            await storage.revertDataUntilBlock(500n);

            // First-pass: all repos get upperBound=2000n
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(2000n);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledWith(
                2000n,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledWith(
                2000n,
            );
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                2000n,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledWith(2000n);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledWith(2000n);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledWith(
                2000n,
            );
            expect(mocks.epochSubmissionRepository.deleteSubmissionsFromBlock).toHaveBeenCalledWith(
                2000n,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                2000n,
            );
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(2000n);
        });

        it('should handle multiple batches correctly', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '3000' },
            });
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 500;
            await storage.revertDataUntilBlock(1000n);

            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledTimes(4);
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                2500n,
                3000n,
            );
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                2000n,
                2500n,
            );
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                1500n,
                2000n,
            );
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                1000n,
                1500n,
            );
        });

        it('should use REINDEX_BATCH_SIZE from config and default to 1000 when 0', async () => {
            // Custom batch size
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 200;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            await storage.revertDataUntilBlock(500n);

            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledTimes(3);
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                800n,
                1000n,
            );
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                600n,
                800n,
            );
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                500n,
                600n,
            );

            vi.clearAllMocks();

            // BATCH_SIZE = 0 defaults to 1000
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 0;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '2000' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
            await storage.revertDataUntilBlock(500n);

            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledTimes(2);
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                1000n,
                2000n,
            );
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                500n,
                1000n,
            );
        });
    });

    // =========================================================================
    // return value, side effects, error propagation
    // =========================================================================
    describe('return value, side effects, error propagation', () => {
        it('should return undefined (void)', async () => {
            const result = await storage.revertDataUntilBlock(500n);
            expect(result).toBeUndefined();
        });

        it('should resolve without error when all repos succeed', async () => {
            await expect(storage.revertDataUntilBlock(500n)).resolves.toBeUndefined();
        });

        it('should propagate error if transactionRepository.deleteTransactionsFromBlockHeight rejects', async () => {
            const error = new Error('Transaction delete failed');
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockRejectedValue(error);
            await expect(storage.revertDataUntilBlock(500n)).rejects.toThrow(
                'Transaction delete failed',
            );
        });

        it('should propagate error if blockRepository.getLatestBlock rejects', async () => {
            const error = new Error('getLatestBlock failed');
            mocks.blockRepository.getLatestBlock.mockRejectedValue(error);
            await expect(storage.revertDataUntilBlock(500n)).rejects.toThrow(
                'getLatestBlock failed',
            );
        });

        it('should propagate error if blockchainInfoRepository.getByNetwork rejects', async () => {
            const error = new Error('getByNetwork failed');
            mocks.blockchainInfoRepository.getByNetwork.mockRejectedValue(error);
            await expect(storage.revertDataUntilBlock(500n)).rejects.toThrow('getByNetwork failed');
        });

        it('should propagate error if targetEpochRepository.deleteAllTargetEpochs rejects', async () => {
            const error = new Error('deleteAllTargetEpochs failed');
            mocks.targetEpochRepository.deleteAllTargetEpochs.mockRejectedValue(error);
            await expect(storage.revertDataUntilBlock(500n)).rejects.toThrow(
                'deleteAllTargetEpochs failed',
            );
        });

        it('should be callable multiple times without side effects leaking', async () => {
            await storage.revertDataUntilBlock(500n);
            await storage.revertDataUntilBlock(300n);

            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalledTimes(2);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(2);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(300n);
        });

        it('should throw specific error messages for each missing repository', async () => {
            const repoNullTests: Array<{
                field: string;
                errorMsg: string;
            }> = [
                { field: 'blockRepository', errorMsg: 'Block header repository not initialized' },
                {
                    field: 'transactionRepository',
                    errorMsg: 'Transaction repository not initialized',
                },
                {
                    field: 'unspentTransactionRepository',
                    errorMsg: 'Unspent transaction repository not initialized',
                },
                { field: 'contractRepository', errorMsg: 'Contract repository not initialized' },
                { field: 'pointerRepository', errorMsg: 'Pointer repository not initialized' },
                {
                    field: 'blockWitnessRepository',
                    errorMsg: 'Block witness repository not initialized',
                },
                { field: 'reorgRepository', errorMsg: 'Reorg repository not initialized' },
                { field: 'mempoolRepository', errorMsg: 'Mempool repository not initialized' },
                { field: 'epochRepository', errorMsg: 'Epoch repository not initialized' },
                {
                    field: 'epochSubmissionRepository',
                    errorMsg: 'Public key repository not initialized',
                },
                {
                    field: 'targetEpochRepository',
                    errorMsg: 'Target epoch repository not initialized',
                },
                {
                    field: 'mldsaPublicKeysRepository',
                    errorMsg: 'MLDSA Public Key repository not initialized',
                },
            ];

            for (const { field, errorMsg } of repoNullTests) {
                const testStorage = createMockVMMongoStorage(mockConfig);
                injectMockRepositories(testStorage, createAllMockRepositories());
                (testStorage as Record<string, unknown>)[field] = null;

                await expect(testStorage.revertDataUntilBlock(500n)).rejects.toThrow(errorMsg);
            }
        });
    });
});
