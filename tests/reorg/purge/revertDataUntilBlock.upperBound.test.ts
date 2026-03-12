import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllMockRepositories, createAllMockRepositories } from '../mocks/mockRepositories.js';
import { createMockVMMongoStorage, injectMockRepositories } from '../mocks/mockVMStorage.js';
import { VMMongoStorage } from '../../../src/src/vm/storage/databases/VMMongoStorage.js';

const { mockConfig } = vi.hoisted(() => {
    // Inline the config creation so it is available before vi.mock hoisting
    return {
        mockConfig: {
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
        } as Record<string, unknown>,
    };
});

vi.mock('../../../src/src/config/Config.js', () => ({
    Config: mockConfig,
}));

// Typed accessors for the mock config sub-objects
const opNet = mockConfig.OP_NET as Record<string, unknown>;
const bitcoin = mockConfig.BITCOIN as Record<string, unknown>;

describe('revertDataUntilBlock - upper bound calculation', () => {
    let storage: VMMongoStorage;
    let mocks: AllMockRepositories;

    beforeEach(() => {
        mocks = createAllMockRepositories();
        storage = createMockVMMongoStorage(mockConfig);
        injectMockRepositories(storage, mocks);

        // Defaults: no latest block, chainInfo inProgressBlock = 0
        mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
        mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({ inProgressBlock: 0 });

        // Non-dev mode by default for parallel execution
        mockConfig.DEV_MODE = false;
        opNet.REINDEX_PURGE_UTXOS = true;
        // Use a very large batch size by default so tests with large upper bounds
        // don't create thousands of batch loop iterations and cause timeouts.
        opNet.REINDEX_BATCH_SIZE = 100_000_000;
    });

    // ---------------------------------------------------------------
    // Helper: extract the upperBound that was passed to first-pass deletes
    // ---------------------------------------------------------------
    function getFirstPassUpperBound(): bigint {
        const call = mocks.transactionRepository.deleteTransactionsFromBlockHeight.mock.calls[0];
        return call[0] as bigint;
    }

    // ---------------------------------------------------------------
    // Tests 181-188 (merged): derivedUpper = max(blockHeaderHeight, chainInfoHeight)
    // ---------------------------------------------------------------
    describe('derivedUpper = max(blockHeaderHeight, chainInfoHeight)', () => {
        it('should pick the larger of blockHeaderHeight and chainInfoHeight', async () => {
            // Case 1: blockHeaderHeight > chainInfoHeight
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '200' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(200n);

            // Case 2: chainInfoHeight > blockHeaderHeight
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 300,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(300n);

            // Case 3: equal values
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '150' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 150,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(150n);
        });

        it('should handle zero and extreme values correctly', async () => {
            // Both zero => derivedUpper=0, upperBound = max(0, 10) = 10
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '0' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(10n);
            expect(getFirstPassUpperBound()).toBe(10n);

            // Large blockHeaderHeight dwarfs small chainInfoHeight
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '999999' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(999999n);

            // Large chainInfoHeight dwarfs small blockHeaderHeight
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 999999,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(999999n);
        });

        it('should distinguish adjacent values (1 vs 2)', async () => {
            // blockHeaderHeight=1, chainInfoHeight=2 => picks 2
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 2,
            });
            await storage.revertDataUntilBlock(0n);
            expect(getFirstPassUpperBound()).toBe(2n);

            // blockHeaderHeight=2, chainInfoHeight=1 => picks 2
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '2' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1,
            });
            await storage.revertDataUntilBlock(0n);
            expect(getFirstPassUpperBound()).toBe(2n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 189-195 (merged): upperBound = max(derivedUpper, blockId)
    // ---------------------------------------------------------------
    describe('upperBound = max(derivedUpper, blockId)', () => {
        it('should pick the larger of derivedUpper and blockId', async () => {
            // derivedUpper > blockId => uses derivedUpper
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '500' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 400,
            });
            await storage.revertDataUntilBlock(100n);
            expect(getFirstPassUpperBound()).toBe(500n);

            // blockId > derivedUpper => uses blockId
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '10' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 5,
            });
            await storage.revertDataUntilBlock(100n);
            expect(getFirstPassUpperBound()).toBe(100n);

            // derivedUpper == blockId => uses that value
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 50,
            });
            await storage.revertDataUntilBlock(100n);
            expect(getFirstPassUpperBound()).toBe(100n);
        });

        it('should handle zero and edge-case blockId/derivedUpper combinations', async () => {
            // derivedUpper=0 and blockId=0
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '0' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(0n);
            expect(getFirstPassUpperBound()).toBe(0n);

            // derivedUpper=0, blockId=1 => blockId wins
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '0' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(1n);
            expect(getFirstPassUpperBound()).toBe(1n);

            // derivedUpper=1, blockId=0 => derivedUpper wins
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(0n);
            expect(getFirstPassUpperBound()).toBe(1n);

            // Very large blockId overrides small derivedUpper
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '5' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 3,
            });
            await storage.revertDataUntilBlock(1000000n);
            expect(getFirstPassUpperBound()).toBe(1000000n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 196-199 (merged): getLatestBlock returns undefined
    // ---------------------------------------------------------------
    describe('getLatestBlock returns undefined', () => {
        it('should fall back to blockId as blockHeaderHeight and compute upperBound correctly', async () => {
            // chainInfoHeight=0 => blockHeaderHeight=blockId=50, upperBound=50
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(50n);

            // chainInfoHeight > blockId => chainInfoHeight dominates
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 200,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(200n);

            // chainInfoHeight < blockId => blockId dominates
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 10,
            });
            await storage.revertDataUntilBlock(100n);
            expect(getFirstPassUpperBound()).toBe(100n);

            // chainInfoHeight == blockId => same value
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 75,
            });
            await storage.revertDataUntilBlock(75n);
            expect(getFirstPassUpperBound()).toBe(75n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 200-202 (merged): getLatestBlock returns a block
    // ---------------------------------------------------------------
    describe('getLatestBlock returns a block', () => {
        it('should use latest block height as blockHeaderHeight in upperBound calculation', async () => {
            // blockHeaderHeight=300 dominates
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '300' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(300n);

            // blockHeaderHeight=20 < blockId=500 => blockId wins
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '20' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 15,
            });
            await storage.revertDataUntilBlock(500n);
            expect(getFirstPassUpperBound()).toBe(500n);

            // blockHeaderHeight == blockId
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(100n);
            expect(getFirstPassUpperBound()).toBe(100n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 203-207 (merged): getByNetwork returns chain info
    // ---------------------------------------------------------------
    describe('getByNetwork returns chain info', () => {
        it('should use inProgressBlock as chainInfoHeight', async () => {
            // inProgressBlock=500 dominates
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });
            await storage.revertDataUntilBlock(10n);
            expect(getFirstPassUpperBound()).toBe(500n);

            // inProgressBlock=0 => chainInfoHeight=0
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(10n);
            expect(getFirstPassUpperBound()).toBe(10n);
        });

        it('should treat falsy inProgressBlock (undefined/null) as 0 and handle large values', async () => {
            // undefined => 0
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: undefined,
            });
            await storage.revertDataUntilBlock(25n);
            expect(getFirstPassUpperBound()).toBe(25n);

            // null => 0
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: null,
            });
            await storage.revertDataUntilBlock(30n);
            expect(getFirstPassUpperBound()).toBe(30n);

            // Large inProgressBlock dominates
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1000000,
            });
            await storage.revertDataUntilBlock(50n);
            expect(getFirstPassUpperBound()).toBe(1000000n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 208-215: upperBound used correctly in first pass and batched pass
    // (KEEP as individual tests - different behaviors)
    // ---------------------------------------------------------------
    describe('upperBound used correctly in first pass and batched pass', () => {
        it('208: all first-pass delete methods receive the same upperBound', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '500' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 300,
            });

            await storage.revertDataUntilBlock(100n);

            const expected = 500n;
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(expected);
            expect(mocks.contractRepository.deleteContractsFromBlockHeight).toHaveBeenCalledWith(
                expected,
            );
            expect(mocks.pointerRepository.deletePointerFromBlockHeight).toHaveBeenCalledWith(
                expected,
            );
            expect(mocks.blockRepository.deleteBlockHeadersFromBlockHeight).toHaveBeenCalledWith(
                expected,
            );
            expect(
                mocks.blockWitnessRepository.deleteBlockWitnessesFromHeight,
            ).toHaveBeenCalledWith(expected);
            expect(mocks.reorgRepository.deleteReorgs).toHaveBeenCalledWith(expected);
            expect(mocks.epochRepository.deleteEpochFromBitcoinBlockNumber).toHaveBeenCalledWith(
                expected,
            );
            expect(mocks.epochSubmissionRepository.deleteSubmissionsFromBlock).toHaveBeenCalledWith(
                expected,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteFromBlockHeight).toHaveBeenCalledWith(
                expected,
            );
        });

        it('209: unspent transaction first-pass receives upperBound when purgeUtxos=true', async () => {
            opNet.REINDEX_PURGE_UTXOS = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '400' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });

            await storage.revertDataUntilBlock(50n);

            expect(
                mocks.unspentTransactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(400n);
        });

        it('210: batched pass uses upperBound as the starting point for iteration', async () => {
            opNet.REINDEX_BATCH_SIZE = 100;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '350' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 200,
            });

            await storage.revertDataUntilBlock(100n);

            // upperBound=350, BATCH_SIZE=100, blockId=100
            // Batch 1: from=250, to=350
            // Batch 2: from=150, to=250
            // Batch 3: from=100, to=150
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls.length).toBe(3);
            expect(calls[0]).toEqual([250n, 350n]);
            expect(calls[1]).toEqual([150n, 250n]);
            expect(calls[2]).toEqual([100n, 150n]);
        });

        it('211: when upperBound == blockId no batched pass occurs', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 50,
            });

            await storage.revertDataUntilBlock(100n);

            // upperBound = max(max(100,50), 100) = 100 = blockId
            // Loop: for (let to = 100; to > 100; ...) => no iterations
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
        });

        it('212: first-pass uses chainInfoHeight-derived upperBound when it dominates', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '50' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 800,
            });

            await storage.revertDataUntilBlock(10n);

            // derivedUpper = max(50, 800) = 800, upperBound = max(800, 10) = 800
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(800n);
        });

        it('213: batched pass range boundaries clamp to blockId', async () => {
            opNet.REINDEX_BATCH_SIZE = 50;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '180' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            await storage.revertDataUntilBlock(100n);

            // upperBound=180, BATCH_SIZE=50, blockId=100
            // Batch 1: to=180, from=max(180-50, 100) = 130
            // Batch 2: to=130, from=max(130-50, 100) = 100
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls.length).toBe(2);
            expect(calls[0]).toEqual([130n, 180n]);
            expect(calls[1]).toEqual([100n, 130n]);
        });

        it('214: all batched-pass repositories receive same from/to values', async () => {
            opNet.REINDEX_BATCH_SIZE = 1000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '200' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            await storage.revertDataUntilBlock(50n);

            // upperBound=200, BATCH_SIZE=1000
            // Single batch: from=max(200-1000, 50) = 50, to=200
            const expectedFrom = 50n;
            const expectedTo = 200n;
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.contractRepository.deleteContractsInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.pointerRepository.deletePointerInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.reorgRepository.deleteReorgsInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.epochRepository.deleteEpochInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.epochSubmissionRepository.deleteSubmissionsInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
            expect(mocks.mldsaPublicKeysRepository.deleteInRange).toHaveBeenCalledWith(
                expectedFrom,
                expectedTo,
            );
        });

        it('215: blockId-derived upperBound is used in first pass when it dominates', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '5' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 3,
            });

            await storage.revertDataUntilBlock(1000n);

            // derivedUpper = max(5, 3) = 5, upperBound = max(5, 1000) = 1000
            expect(getFirstPassUpperBound()).toBe(1000n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 216-225 (merged where trivially similar): combined scenarios
    // ---------------------------------------------------------------
    describe('combined scenarios', () => {
        it('should pick the correct max when all three values are equal', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });

            await storage.revertDataUntilBlock(100n);

            expect(getFirstPassUpperBound()).toBe(100n);
        });

        it('should pick whichever of the three values is highest', async () => {
            // blockHeaderHeight highest
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });
            await storage.revertDataUntilBlock(200n);
            expect(getFirstPassUpperBound()).toBe(1000n);

            // chainInfoHeight highest
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '200' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1000,
            });
            await storage.revertDataUntilBlock(500n);
            expect(getFirstPassUpperBound()).toBe(1000n);

            // blockId highest
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 200,
            });
            await storage.revertDataUntilBlock(1000n);
            expect(getFirstPassUpperBound()).toBe(1000n);
        });

        it('should handle undefined latest block with blockId vs chainInfoHeight', async () => {
            // blockId > chainInfoHeight
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 10,
            });
            await storage.revertDataUntilBlock(500n);
            expect(getFirstPassUpperBound()).toBe(500n);

            // chainInfoHeight > blockId
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });
            await storage.revertDataUntilBlock(10n);
            expect(getFirstPassUpperBound()).toBe(500n);
        });

        it('should handle all-ones scenario and values differing by 1', async () => {
            // all=1
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1,
            });
            await storage.revertDataUntilBlock(1n);
            expect(getFirstPassUpperBound()).toBe(1n);

            // blockHeaderHeight just above
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '101' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });
            await storage.revertDataUntilBlock(99n);
            expect(getFirstPassUpperBound()).toBe(101n);

            // chainInfoHeight just above
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 101,
            });
            await storage.revertDataUntilBlock(99n);
            expect(getFirstPassUpperBound()).toBe(101n);

            // blockId just above
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });
            await storage.revertDataUntilBlock(101n);
            expect(getFirstPassUpperBound()).toBe(101n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 226-230 (merged): height string parsing
    // ---------------------------------------------------------------
    describe('height string parsing', () => {
        it('should parse height.toString() numeric strings and custom toString correctly', async () => {
            // Standard numeric string
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '12345' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(10n);
            expect(getFirstPassUpperBound()).toBe(12345n);

            // "0" parses as 0n
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '0' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(5n);
            expect(getFirstPassUpperBound()).toBe(5n);

            // Custom toString
            vi.clearAllMocks();
            const customHeight = {
                toString() {
                    return '777';
                },
            };
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: customHeight,
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });
            await storage.revertDataUntilBlock(10n);
            expect(getFirstPassUpperBound()).toBe(777n);

            // inProgressBlock as numeric is converted via BigInt()
            vi.clearAllMocks();
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 42,
            });
            await storage.revertDataUntilBlock(10n);
            expect(getFirstPassUpperBound()).toBe(42n);
        });

        it('should handle MAX_SAFE_INTEGER-sized height strings', async () => {
            const largeHeight = 9007199254740991n; // Number.MAX_SAFE_INTEGER
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '9007199254740991' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            // Use a blockId close to the large height to avoid massive batch iterations
            await storage.revertDataUntilBlock(largeHeight - 1n);

            expect(getFirstPassUpperBound()).toBe(largeHeight);
        });
    });

    // ---------------------------------------------------------------
    // Tests 231-235: blockId edge values (KEEP as individual tests)
    // ---------------------------------------------------------------
    describe('blockId edge values', () => {
        it('231: blockId=0n with no data gives upperBound=0', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            await storage.revertDataUntilBlock(0n);

            expect(getFirstPassUpperBound()).toBe(0n);
        });

        it('232: blockId=0n with existing data uses data heights', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '500' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 300,
            });

            await storage.revertDataUntilBlock(0n);

            expect(getFirstPassUpperBound()).toBe(500n);
        });

        it('233: blockId=1n with higher data heights', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '1000' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 800,
            });

            await storage.revertDataUntilBlock(1n);

            expect(getFirstPassUpperBound()).toBe(1000n);
        });

        it('234: very large blockId with small data heights', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '10' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 5,
            });

            await storage.revertDataUntilBlock(999999999n);

            expect(getFirstPassUpperBound()).toBe(999999999n);
        });

        it('235: blockId equals MAX_SAFE_INTEGER as bigint', async () => {
            const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({
                height: { toString: () => '100' },
            });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 50,
            });

            await storage.revertDataUntilBlock(maxSafe);

            // derivedUpper = max(100, 50) = 100, upperBound = max(100, maxSafe) = maxSafe
            expect(getFirstPassUpperBound()).toBe(maxSafe);
        });
    });

    // ---------------------------------------------------------------
    // Tests 236-240 (merged): getLatestBlock and getByNetwork call order
    // ---------------------------------------------------------------
    describe('getLatestBlock and getByNetwork call order', () => {
        it('should call getLatestBlock and getByNetwork exactly once each, before any deletes', async () => {
            const callOrder: string[] = [];

            mocks.blockRepository.getLatestBlock.mockImplementation(async () => {
                callOrder.push('getLatestBlock');
                return { height: { toString: () => '100' } };
            });
            mocks.blockchainInfoRepository.getByNetwork.mockImplementation(async () => {
                callOrder.push('getByNetwork');
                return { inProgressBlock: 50 };
            });
            mocks.transactionRepository.deleteTransactionsFromBlockHeight.mockImplementation(
                async () => {
                    callOrder.push('deleteTransactions');
                },
            );
            mocks.contractRepository.deleteContractsFromBlockHeight.mockImplementation(async () => {
                callOrder.push('deleteContracts');
            });

            await storage.revertDataUntilBlock(10n);

            // Each called exactly once
            expect(mocks.blockRepository.getLatestBlock).toHaveBeenCalledTimes(1);
            expect(mocks.blockchainInfoRepository.getByNetwork).toHaveBeenCalledTimes(1);

            // Both called before any deletes
            const getLatestIdx = callOrder.indexOf('getLatestBlock');
            const getByNetworkIdx = callOrder.indexOf('getByNetwork');
            const deleteTransactionsIdx = callOrder.indexOf('deleteTransactions');
            const deleteContractsIdx = callOrder.indexOf('deleteContracts');
            expect(getLatestIdx).toBeLessThan(deleteTransactionsIdx);
            expect(getByNetworkIdx).toBeLessThan(deleteContractsIdx);
        });

        it('should call getByNetwork with the configured NETWORK', async () => {
            bitcoin.NETWORK = 'mainnet';
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            await storage.revertDataUntilBlock(10n);

            expect(mocks.blockchainInfoRepository.getByNetwork).toHaveBeenCalledWith('mainnet');

            // Reset
            bitcoin.NETWORK = 'regtest';
        });
    });
});
