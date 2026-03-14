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

describe('revertDataUntilBlock - First Pass (Category 4)', () => {
    let storage: VMMongoStorage;
    let mocks: AllMockRepositories;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConfig.DEV_MODE = false;
        mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
        mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
        mockConfig.BITCOIN.NETWORK = 'regtest';

        mocks = createAllMockRepositories();
        storage = createMockVMMongoStorage(mockConfig);
        injectMockRepositories(storage, mocks);

        // Default: latestBlock height = blockId, chainInfo = 0 => upperBound = blockId
        mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 100 });
        mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
    });

    /** All unbounded deletes called with upperBound */
    describe('all unbounded deletes called with upperBound', () => {
        it('should call all first-pass unbounded delete methods with upperBound', async () => {
            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(100n);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledWith(100n);
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledWith(100n);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledWith(100n);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledWith(
                100n,
            );
            expect(mocks.epochSubmissionRepository.deleteSubmissionsFromBlock).toHaveBeenCalledWith(
                100n,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(100n);
        });
    });

    /** purgeUtxos gating */
    describe('purgeUtxos gating', () => {
        it('should gate UTXO delete on purgeUtxos=true and call it in both modes', async () => {
            // purgeUtxos = true, non-DEV_MODE
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalled();

            vi.clearAllMocks();

            // purgeUtxos = true, DEV_MODE
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalled();
        });

        it('should skip UTXO delete when purgeUtxos=false but still call all other repos', async () => {
            // purgeUtxos = false, non-DEV_MODE
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();

            // Non-UTXO repos should still be called
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
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );

            vi.clearAllMocks();

            // purgeUtxos = false, DEV_MODE
            mockConfig.DEV_MODE = true;
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();
        });
    });

    /** DEV_MODE sequential first pass */
    describe('DEV_MODE sequential first pass', () => {
        beforeEach(() => {
            mockConfig.DEV_MODE = true;
        });

        it('in DEV_MODE, deletes are called sequentially (all repos called)', async () => {
            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(100n);
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(100n);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledWith(100n);
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledWith(100n);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledWith(100n);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledWith(
                100n,
            );
            expect(mocks.epochSubmissionRepository.deleteSubmissionsFromBlock).toHaveBeenCalledWith(
                100n,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );
        });

        it('DEV_MODE sequential order: transactions called before contracts', async () => {
            const callOrder: string[] = [];
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('transactions');
                },
            );
            mocks.contractRepository.deleteContractsFromBlockHeight.mockImplementation(async () => {
                callOrder.push('contracts');
            });

            await storage.revertDataUntilBlock(100n);

            const txIdx = callOrder.indexOf('transactions');
            const contractIdx = callOrder.indexOf('contracts');
            expect(txIdx).toBeLessThan(contractIdx);
        });

        it('DEV_MODE sequential order: transactions first, MLDSA last', async () => {
            const callOrder: string[] = [];
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('transactions');
                },
            );
            mocks.mldsaPublicKeysRepository.deleteFromBlockHeight.mockImplementation(async () => {
                callOrder.push('mldsa');
            });

            await storage.revertDataUntilBlock(100n);

            expect(callOrder[0]).toBe('transactions');
            expect(callOrder[callOrder.length - 1]).toBe('mldsa');
        });

        it('DEV_MODE sequential order: utxos called after transactions when purgeUtxos is true', async () => {
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

            await storage.revertDataUntilBlock(100n);

            const txIdx = callOrder.indexOf('transactions');
            const utxoIdx = callOrder.indexOf('utxos');
            const contractIdx = callOrder.indexOf('contracts');
            expect(txIdx).toBeLessThan(utxoIdx);
            expect(utxoIdx).toBeLessThan(contractIdx);
        });
    });

    /** Parallel first pass (non-DEV_MODE) */
    describe('parallel first pass (non-DEV_MODE)', () => {
        beforeEach(() => {
            mockConfig.DEV_MODE = false;
        });

        it('in parallel mode, all base repo deletes are called once', async () => {
            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledTimes(
                1,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledTimes(
                1,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledTimes(1);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledTimes(
                1,
            );
            expect(
                mocks.epochSubmissionRepository.deleteSubmissionsFromBlock,
            ).toHaveBeenCalledTimes(1);
        });

        it('in parallel mode, UTXO repo is included when purgeUtxos is true', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;

            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(1);
        });

        it('in parallel mode, UTXO repo is excluded when purgeUtxos is false', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;

            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();
        });

        it('in parallel mode, MLDSA repo is always called regardless of purgeUtxos setting', async () => {
            await storage.revertDataUntilBlock(100n);

            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledTimes(1);
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                100n,
            );

            vi.clearAllMocks();

            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            await storage.revertDataUntilBlock(100n);

            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledTimes(1);
        });
    });

    /** upperBound == blockId */
    describe('upperBound == blockId', () => {
        it('when latestBlock.height == blockId and chainInfo == 0, upperBound == blockId', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 50 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(50n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(50n);
        });

        it('when latestBlock is null, upperBound falls back to blockId', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(75n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(75n);
        });

        it('when both latestBlock.height and chainInfo < blockId, upperBound == blockId', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 10 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 5 });

            await storage.revertDataUntilBlock(50n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(50n);
        });

        it('when upperBound == blockId, no batched pass iterations occur (no range deletes)', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 50 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(50n);

            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
            expect(mocks.contractRepository.deleteContractsInRange).not.toHaveBeenCalled();
        });

        it('first pass still called even when upperBound == blockId', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 50 });

            await storage.revertDataUntilBlock(50n);

            // First pass (unbounded) is always called
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledTimes(
                1,
            );
        });
    });

    /** upperBound >> blockId */
    describe('upperBound >> blockId', () => {
        it('when latestBlock.height >> blockId, first pass uses the higher upperBound', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 10000 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(10000n);
        });

        it('when chainInfo >> blockId and > latestBlock, first pass uses chainInfo height', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 100 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 50000,
            });

            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(50000n);
        });

        it('when both heights are very large, all first pass deletes use the max', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 999999 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500000,
            });

            await storage.revertDataUntilBlock(50n);

            const expectedUpper = 999999n;
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(expectedUpper);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledWith(
                expectedUpper,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledWith(
                expectedUpper,
            );
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                expectedUpper,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledWith(expectedUpper);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledWith(expectedUpper);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledWith(
                expectedUpper,
            );
            expect(mocks.epochSubmissionRepository.deleteSubmissionsFromBlock).toHaveBeenCalledWith(
                expectedUpper,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                expectedUpper,
            );
        });

        it('large gap between upperBound and blockId triggers batched pass but first pass still uses upperBound', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 5000 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(100n);

            // First pass uses 5000n
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(5000n);
            // Batched pass also runs (range deletes)
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
        });
    });

    /** First pass argument values for various upperBound sources */
    describe('first pass argument values for various upperBound sources', () => {
        it('should derive upperBound correctly from various latestBlock/chainInfo/blockId combinations', async () => {
            // blockId=0, latestBlock=null => upperBound=0n
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
            await storage.revertDataUntilBlock(0n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(0n);

            vi.clearAllMocks();

            // blockId=1, latestBlock.height=1, chainInfo=1 => upperBound=1n
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 1 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 1 });
            await storage.revertDataUntilBlock(1n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(1n);

            vi.clearAllMocks();

            // chainInfo higher than latestBlock but both lower than blockId => upperBound=blockId
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 5 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 8 });
            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(100n);

            vi.clearAllMocks();

            // latestBlock exactly equals chainInfo and both > blockId => upperBound = that value
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 500 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 500 });
            await storage.revertDataUntilBlock(100n);
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
        });

        it('upperBound derived from latestBlock when it is highest', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 2000 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 500 });

            await storage.revertDataUntilBlock(100n);

            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                2000n,
            );
        });

        it('upperBound derived from chainInfo when it is highest', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 100 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 3000,
            });

            await storage.revertDataUntilBlock(50n);

            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                3000n,
            );
        });

        it('upperBound derived from blockId when both heights are lower', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 10 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 20 });

            await storage.revertDataUntilBlock(500n);

            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                500n,
            );
        });

        it('when latestBlock is null and chainInfo is 0, upperBound equals blockId', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(null);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(200n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(200n);
        });

        it('when latestBlock is null and chainInfo > blockId, upperBound = chainInfo', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(null);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1000,
            });

            await storage.revertDataUntilBlock(200n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(1000n);
        });
    });

    /** First pass called exactly once */
    describe('first pass called exactly once', () => {
        it('each first-pass delete is called exactly once in both modes', async () => {
            // non-DEV_MODE
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 200 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledTimes(
                1,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledTimes(
                1,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledTimes(1);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledTimes(
                1,
            );
            expect(
                mocks.epochSubmissionRepository.deleteSubmissionsFromBlock,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledTimes(1);
            // UTXO first-pass delete called exactly once when purgeUtxos is true
            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(1);

            vi.clearAllMocks();

            // DEV_MODE
            mockConfig.DEV_MODE = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 200 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledTimes(
                1,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledTimes(1);
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledTimes(
                1,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledTimes(1);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledTimes(
                1,
            );
            expect(
                mocks.epochSubmissionRepository.deleteSubmissionsFromBlock,
            ).toHaveBeenCalledTimes(1);
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledTimes(1);
        });
    });

    /** First pass timing relative to target epoch delete */
    describe('first pass timing relative to target epoch delete', () => {
        it('target epoch deleteAllTargetEpochs is called before first pass', async () => {
            const callOrder: string[] = [];
            mocks.targetEpochRepository.deleteAllTargetEpochs.mockImplementation(async () => {
                callOrder.push('targetEpoch');
            });
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('firstPass');
                },
            );

            await storage.revertDataUntilBlock(100n);

            const targetIdx = callOrder.indexOf('targetEpoch');
            const firstPassIdx = callOrder.indexOf('firstPass');
            expect(targetIdx).toBeLessThan(firstPassIdx);
        });

        it('target epoch delete completes before any first pass delete in DEV_MODE', async () => {
            mockConfig.DEV_MODE = true;
            const callOrder: string[] = [];
            mocks.targetEpochRepository.deleteAllTargetEpochs.mockImplementation(async () => {
                callOrder.push('targetEpoch');
            });
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('firstPassTx');
                },
            );
            mocks.contractRepository.deleteContractsFromBlockHeight.mockImplementation(async () => {
                callOrder.push('firstPassContract');
            });

            await storage.revertDataUntilBlock(100n);

            expect(callOrder[0]).toBe('targetEpoch');
        });
    });

    /** Metadata queries */
    describe('metadata queries', () => {
        it('getLatestBlock is called exactly once during the method', async () => {
            await storage.revertDataUntilBlock(100n);

            expect(mocks.blockRepository.getLatestBlock).toHaveBeenCalledTimes(1);
        });

        it('getByNetwork is called with the configured NETWORK string', async () => {
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            await storage.revertDataUntilBlock(100n);

            expect(mocks.blockchainInfoRepository.getByNetwork).toHaveBeenCalledWith('mainnet');
        });
    });
});
