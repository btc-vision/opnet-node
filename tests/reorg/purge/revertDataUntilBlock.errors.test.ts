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

describe('revertDataUntilBlock - Error Handling (Category 5)', () => {
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

        mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 100 });
        mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
    });

    /** Tests 291-302: repository null checks */
    describe('Tests 291-302: repository null checks', () => {
        it('291: throws when blockRepository is undefined', async () => {
            Reflect.set(storage, 'blockRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Block header repository not initialized',
            );
        });

        it('292: throws when transactionRepository is undefined', async () => {
            Reflect.set(storage, 'transactionRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Transaction repository not initialized',
            );
        });

        it('293: throws when unspentTransactionRepository is undefined', async () => {
            Reflect.set(storage, 'unspentTransactionRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Unspent transaction repository not initialized',
            );
        });

        it('294: throws when contractRepository is undefined', async () => {
            Reflect.set(storage, 'contractRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Contract repository not initialized',
            );
        });

        it('295: throws when pointerRepository is undefined', async () => {
            Reflect.set(storage, 'pointerRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Pointer repository not initialized',
            );
        });

        it('296: throws when blockWitnessRepository is undefined', async () => {
            Reflect.set(storage, 'blockWitnessRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Block witness repository not initialized',
            );
        });

        it('297: throws when reorgRepository is undefined', async () => {
            Reflect.set(storage, 'reorgRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Reorg repository not initialized',
            );
        });

        it('298: throws when mempoolRepository is undefined', async () => {
            Reflect.set(storage, 'mempoolRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Mempool repository not initialized',
            );
        });

        it('299: throws when epochRepository is undefined', async () => {
            Reflect.set(storage, 'epochRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Epoch repository not initialized',
            );
        });

        it('300: throws when epochSubmissionRepository is undefined (message says "Public key")', async () => {
            Reflect.set(storage, 'epochSubmissionRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Public key repository not initialized',
            );
        });

        it('301: throws when targetEpochRepository is undefined', async () => {
            Reflect.set(storage, 'targetEpochRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Target epoch repository not initialized',
            );
        });

        it('302: throws when mldsaPublicKeysRepository is undefined', async () => {
            Reflect.set(storage, 'mldsaPublicKeysRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'MLDSA Public Key repository not initialized',
            );
        });
    });

    /** Tests 303-308: repository delete throws during first pass */
    describe('Tests 303-308: repository delete throws during first pass', () => {
        it('303: transaction delete throws in first pass propagates error', async () => {
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockRejectedValue(
                new Error('transaction delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'transaction delete failed',
            );
        });

        it('304: contract delete throws in first pass propagates error', async () => {
            mocks.contractRepository.deleteContractsFromBlockHeight.mockRejectedValue(
                new Error('contract delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'contract delete failed',
            );
        });

        it('305: block header delete throws in first pass propagates error', async () => {
            mocks.blockRepository.deleteBlockHeadersFromBlockHeight.mockRejectedValue(
                new Error('block header delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'block header delete failed',
            );
        });

        it('306: MLDSA delete throws in first pass propagates error', async () => {
            mocks.mldsaPublicKeysRepository.deleteFromBlockHeight.mockRejectedValue(
                new Error('mldsa delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow('mldsa delete failed');
        });

        it('307: epoch delete throws in first pass propagates error', async () => {
            mocks.epochRepository.deleteEpochFromBitcoinBlockNumber.mockRejectedValue(
                new Error('epoch delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow('epoch delete failed');
        });

        it('308: UTXO delete throws in first pass propagates error when purgeUtxos is true', async () => {
            mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight.mockRejectedValue(
                new Error('utxo delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow('utxo delete failed');
        });
    });

    /** Tests 309-314: repository delete throws during batched pass */
    describe('Tests 309-314: repository delete throws during batched pass', () => {
        beforeEach(() => {
            // Set up a gap so the batched pass runs (upperBound=200, blockId=100, batchSize=1000)
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 200 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
        });

        it('309: transaction range delete throws in batched pass propagates error', async () => {
            mocks.transactionRepository.deleteTransactionsInRange.mockRejectedValue(
                new Error('tx range delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'tx range delete failed',
            );
        });

        it('310: contract range delete throws in batched pass propagates error', async () => {
            mocks.contractRepository.deleteContractsInRange.mockRejectedValue(
                new Error('contract range delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'contract range delete failed',
            );
        });

        it('311: block header range delete throws in batched pass propagates error', async () => {
            mocks.blockRepository.deleteBlockHeadersInRange.mockRejectedValue(
                new Error('block header range failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'block header range failed',
            );
        });

        it('312: MLDSA range delete throws in batched pass propagates error', async () => {
            mocks.mldsaPublicKeysRepository.deleteInRange.mockRejectedValue(
                new Error('mldsa range delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'mldsa range delete failed',
            );
        });

        it('313: epoch range delete throws in batched pass propagates error', async () => {
            mocks.epochRepository.deleteEpochInRange.mockRejectedValue(
                new Error('epoch range delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'epoch range delete failed',
            );
        });

        it('314: UTXO range delete throws in batched pass propagates error', async () => {
            mocks.unspentTransactionRepository.deleteTransactionsInRange.mockRejectedValue(
                new Error('utxo range delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'utxo range delete failed',
            );
        });
    });

    /** Tests 315-319: getLatestBlock/getByNetwork throws */
    describe('Tests 315-319: getLatestBlock/getByNetwork throws', () => {
        it('315: getLatestBlock throwing propagates error', async () => {
            mocks.blockRepository.getLatestBlock.mockRejectedValue(
                new Error('getLatestBlock failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'getLatestBlock failed',
            );
        });

        it('316: getByNetwork throwing propagates error', async () => {
            mocks.blockchainInfoRepository.getByNetwork.mockRejectedValue(
                new Error('getByNetwork failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow('getByNetwork failed');
        });

        it('317: getLatestBlock error prevents any first pass deletes', async () => {
            mocks.blockRepository.getLatestBlock.mockRejectedValue(
                new Error('getLatestBlock failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow();

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();
        });

        it('318: getByNetwork error prevents any first pass deletes', async () => {
            mocks.blockchainInfoRepository.getByNetwork.mockRejectedValue(
                new Error('getByNetwork failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow();

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();
        });

        it('319: blockchainInfoRepository being undefined causes getByNetwork to throw via getter', async () => {
            Reflect.set(storage, 'blockchainInfoRepository', undefined);

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'Blockchain info repository not initialized',
            );
        });
    });

    /** Tests 320-321: mempool purge error */
    describe('Tests 320-321: mempool purge error', () => {
        it('320: mempool deleteGreaterThanBlockHeight throwing propagates error when blockId <= 0', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 0 });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });
            mocks.mempoolRepository.deleteGreaterThanBlockHeight.mockRejectedValue(
                new Error('mempool purge failed'),
            );

            await expect(storage.revertDataUntilBlock(0n)).rejects.toThrow('mempool purge failed');
        });

        it('321: mempool purge not called when blockId > 0 (so no error even if mock would reject)', async () => {
            mocks.mempoolRepository.deleteGreaterThanBlockHeight.mockRejectedValue(
                new Error('mempool purge failed'),
            );

            // blockId = 100, so mempool purge branch (blockId <= 0) is not entered
            await expect(storage.revertDataUntilBlock(100n)).resolves.toBeUndefined();

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });
    });

    /** Tests 322-323: target epoch delete error */
    describe('Tests 322-323: target epoch delete error', () => {
        it('322: targetEpochRepository.deleteAllTargetEpochs throwing propagates error', async () => {
            mocks.targetEpochRepository.deleteAllTargetEpochs.mockRejectedValue(
                new Error('target epoch delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'target epoch delete failed',
            );
        });

        it('323: target epoch error prevents first pass from running', async () => {
            mocks.targetEpochRepository.deleteAllTargetEpochs.mockRejectedValue(
                new Error('target epoch delete failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow();

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).not.toHaveBeenCalled();
        });
    });

    /** Tests 324-326: partial failure scenarios */
    describe('Tests 324-326: partial failure scenarios', () => {
        it('324: in DEV_MODE, first repo failure stops subsequent sequential deletes', async () => {
            mockConfig.DEV_MODE = true;
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockRejectedValue(
                new Error('tx first pass failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'tx first pass failed',
            );

            // Since it's sequential and transactions is first, contracts should not have been called
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).not.toHaveBeenCalled();
        });

        it('325: in DEV_MODE, middle repo failure stops subsequent sequential deletes', async () => {
            mockConfig.DEV_MODE = true;
            mocks.contractRepository.deleteContractsFromBlockHeight.mockRejectedValue(
                new Error('contract first pass failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'contract first pass failed',
            );

            // Transactions should have been called (before contracts), but pointers should not
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalled();
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).not.toHaveBeenCalled();
        });

        it('326: in parallel mode, one rejection causes Promise.safeAll to throw', async () => {
            mockConfig.DEV_MODE = false;
            mocks.pointerRepository.deletePointerFromBlockHeight.mockRejectedValue(
                new Error('pointer first pass failed'),
            );

            await expect(storage.revertDataUntilBlock(100n)).rejects.toThrow(
                'pointer first pass failed',
            );
        });
    });

    /** Tests 327-330: error message content */
    describe('Tests 327-330: error message content', () => {
        it('328: epochSubmissionRepository null check says "Public key" not "Epoch submission"', async () => {
            Reflect.set(storage, 'epochSubmissionRepository', undefined);

            try {
                await storage.revertDataUntilBlock(100n);
                expect.unreachable('Should have thrown');
            } catch (e: any) {
                expect(e).toBeInstanceOf(Error);
                expect(e.message).toBe('Public key repository not initialized');
                expect(e.message).not.toContain('Epoch submission');
            }
        });

        it('329: mldsaPublicKeysRepository null check uses exact error message with capitalization', async () => {
            Reflect.set(storage, 'mldsaPublicKeysRepository', undefined);

            try {
                await storage.revertDataUntilBlock(100n);
                expect.unreachable('Should have thrown');
            } catch (e: any) {
                expect(e).toBeInstanceOf(Error);
                expect(e.message).toBe('MLDSA Public Key repository not initialized');
            }
        });

        it('330: all 12 null check errors are Error instances (not strings or other types)', async () => {
            const repoFields = [
                'blockRepository',
                'transactionRepository',
                'unspentTransactionRepository',
                'contractRepository',
                'pointerRepository',
                'blockWitnessRepository',
                'reorgRepository',
                'mempoolRepository',
                'epochRepository',
                'epochSubmissionRepository',
                'targetEpochRepository',
                'mldsaPublicKeysRepository',
            ];

            for (const field of repoFields) {
                const freshMocks = createAllMockRepositories();
                const freshStorage = createMockVMMongoStorage(mockConfig);
                injectMockRepositories(freshStorage, freshMocks);
                freshMocks.blockRepository.getLatestBlock.mockResolvedValue({ height: 100 });
                freshMocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                    inProgressBlock: 0,
                });

                Reflect.set(freshStorage, field, undefined);

                try {
                    await freshStorage.revertDataUntilBlock(100n);
                    expect.unreachable(`Should have thrown for ${field}`);
                } catch (e: any) {
                    expect(e).toBeInstanceOf(Error);
                    expect(typeof e.message).toBe('string');
                    expect(e.message.length).toBeGreaterThan(0);
                }
            }
        });
    });
});
