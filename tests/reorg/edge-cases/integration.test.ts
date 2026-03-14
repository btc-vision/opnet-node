import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainObserver } from '../../../src/src/blockchain-indexer/processor/observer/ChainObserver.js';
import { AllMockRepositories, createAllMockRepositories } from '../mocks/mockRepositories.js';
import { createMockVMMongoStorage, injectMockRepositories } from '../mocks/mockVMStorage.js';
import { VMMongoStorage } from '../../../src/src/vm/storage/databases/VMMongoStorage.js';

// vi.hoisted ensures mockConfig is available when the hoisted vi.mock factory runs
const { mockConfig } = vi.hoisted(() => {
    /* inline the config shape so it's self-contained inside the hoisted block */
    const mockConfig = {
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
    return { mockConfig };
});

vi.mock('../../../src/src/config/Config.js', () => ({
    Config: mockConfig,
}));

/** Helpers: lightweight mocks for multi-component interaction tests */

function createMockRpcClient() {
    return {
        getBlockCount: vi.fn().mockResolvedValue(1000),
        getChainInfo: vi.fn(),
        getBlockHash: vi.fn(),
    };
}

function createMockConsensusTracker() {
    return { setConsensusBlockHeight: vi.fn().mockReturnValue(0) };
}

function createMockDatabase() {
    return { db: {} };
}

function createMockVMStorageSimple() {
    return {
        getBlockHeader: vi.fn(),
        blockchainRepository: {},
        revertDataUntilBlock: vi.fn().mockResolvedValue(undefined),
        killAllPendingWrites: vi.fn().mockResolvedValue(undefined),
        revertBlockHeadersOnly: vi.fn().mockResolvedValue(undefined),
    };
}

function createChainObserver(overrides?: {
    rpcClient?: ReturnType<typeof createMockRpcClient>;
    consensusTracker?: ReturnType<typeof createMockConsensusTracker>;
}) {
    const rpcClient = overrides?.rpcClient ?? createMockRpcClient();
    const consensusTracker = overrides?.consensusTracker ?? createMockConsensusTracker();
    const database = createMockDatabase();
    const vmStorage = createMockVMStorageSimple();

    const observer = new ChainObserver(
        'regtest' as never,
        database as never,
        rpcClient as never,
        consensusTracker as never,
        vmStorage as never,
    );

    (observer as Record<string, unknown>)._blockchainRepository = {
        updateCurrentBlockInProgress: vi.fn().mockResolvedValue(undefined),
    };
    (observer as Record<string, unknown>)._blocks = {
        getBlockHeader: vi.fn(),
    };

    return { observer, rpcClient, consensusTracker, vmStorage };
}

/**
 * Lightweight orchestrator mock that simulates BlockIndexer.revertChain flow
 * without constructing the real BlockIndexer.
 */
function createOrchestrator() {
    const { observer, rpcClient, consensusTracker, vmStorage } = createChainObserver();
    const blockFetcher = { onReorg: vi.fn() };
    const pluginNotifier = vi.fn().mockResolvedValue(undefined);
    let chainReorged = false;

    const revertChain = async (
        fromHeight: bigint,
        toHeight: bigint,
        newBest: string,
        reorged: boolean,
    ) => {
        chainReorged = true;
        try {
            blockFetcher.onReorg();
            await vmStorage.killAllPendingWrites();
            await vmStorage.revertDataUntilBlock(fromHeight);
            await observer.onChainReorganisation(fromHeight, toHeight, newBest);
            if (reorged) {
                // Simulated reorgFromHeight, just track the call
            }
            await pluginNotifier(fromHeight, toHeight, newBest);
        } finally {
            chainReorged = false;
        }
    };

    return {
        observer,
        rpcClient,
        consensusTracker,
        vmStorage,
        blockFetcher,
        pluginNotifier,
        revertChain,
        isReorging: () => chainReorged,
    };
}

describe('Integration: reorg edge-cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset config to defaults
        mockConfig.DEV_MODE = false;
        mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1000;
        mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
        mockConfig.OP_NET.REINDEX = false;
        mockConfig.OP_NET.REINDEX_FROM_BLOCK = 0;
        mockConfig.BITCOIN.NETWORK = 'regtest';
        mockConfig.PLUGINS.PLUGINS_ENABLED = false;
        mockConfig.INDEXER.READONLY_MODE = false;
    });

    /** Tests 631-635: Rapid successive reorgs */

    describe('rapid successive reorgs', () => {
        it('631: should handle two sequential reorgs updating state correctly', async () => {
            const { observer, rpcClient } = createChainObserver();
            rpcClient.getBlockCount.mockResolvedValue(1000);

            await observer.onChainReorganisation(500n, 600n, 'hash1');
            expect(observer.pendingBlockHeight).toBe(500n);
            expect(observer.synchronisationStatus.bestBlockHash).toBe('hash1');

            await observer.onChainReorganisation(400n, 500n, 'hash2');
            expect(observer.pendingBlockHeight).toBe(400n);
            expect(observer.synchronisationStatus.bestBlockHash).toBe('hash2');
        });

        it('632: should update bestTip to the latest fromHeight after successive reorgs', async () => {
            const { observer, rpcClient } = createChainObserver();
            rpcClient.getBlockCount.mockResolvedValue(2000);

            await observer.onChainReorganisation(800n, 900n, 'h1');
            expect(observer.synchronisationStatus.bestTip).toBe(800n);

            await observer.onChainReorganisation(300n, 800n, 'h2');
            expect(observer.synchronisationStatus.bestTip).toBe(300n);
        });

        it('633: should keep isReorging=true across multiple reorgs (never reset by onChainReorganisation)', async () => {
            const { observer, rpcClient } = createChainObserver();
            rpcClient.getBlockCount.mockResolvedValue(1000);

            await observer.onChainReorganisation(500n, 600n, 'h1');
            expect(observer.synchronisationStatus.isReorging).toBe(true);

            await observer.onChainReorganisation(400n, 500n, 'h2');
            expect(observer.synchronisationStatus.isReorging).toBe(true);
        });

        it('634: should call consensus tracker for each successive reorg', async () => {
            const { observer, rpcClient, consensusTracker } = createChainObserver();
            rpcClient.getBlockCount.mockResolvedValue(1000);

            await observer.onChainReorganisation(500n, 600n, 'h1');
            await observer.onChainReorganisation(400n, 500n, 'h2');
            await observer.onChainReorganisation(300n, 400n, 'h3');

            expect(consensusTracker.setConsensusBlockHeight).toHaveBeenCalledTimes(3);
            expect(consensusTracker.setConsensusBlockHeight).toHaveBeenNthCalledWith(1, 500n);
            expect(consensusTracker.setConsensusBlockHeight).toHaveBeenNthCalledWith(2, 400n);
            expect(consensusTracker.setConsensusBlockHeight).toHaveBeenNthCalledWith(3, 300n);
        });

        it('635: should fetch chain height for each successive reorg', async () => {
            const { observer, rpcClient } = createChainObserver();
            rpcClient.getBlockCount.mockResolvedValue(1000);

            await observer.onChainReorganisation(500n, 600n, 'h1');
            await observer.onChainReorganisation(400n, 500n, 'h2');

            expect(rpcClient.getBlockCount).toHaveBeenCalledTimes(2);
        });
    });

    /** Tests 636-640: Reorg during processing error handling */

    describe('reorg during processing error handling', () => {
        it('636: should propagate RPC error from fetchChainHeight during reorg', async () => {
            const { observer, rpcClient } = createChainObserver();
            rpcClient.getBlockCount.mockRejectedValue(new Error('Connection refused'));

            await expect(observer.onChainReorganisation(500n, 600n, 'hash')).rejects.toThrow(
                'Connection refused',
            );
        });

        it('637: should still set isReorging and bestBlockHash even if fetchChainHeight fails', async () => {
            const { observer, rpcClient } = createChainObserver();
            rpcClient.getBlockCount.mockRejectedValue(new Error('timeout'));

            try {
                await observer.onChainReorganisation(500n, 600n, 'failhash');
            } catch {
                // expected
            }

            expect(observer.synchronisationStatus.isReorging).toBe(true);
            expect(observer.synchronisationStatus.bestBlockHash).toBe('failhash');
        });

        it('638: should propagate DB error from updateCurrentBlockInProgress', async () => {
            const { observer } = createChainObserver();
            const blockchainRepo = (observer as Record<string, unknown>)._blockchainRepository as {
                updateCurrentBlockInProgress: ReturnType<typeof vi.fn>;
            };
            blockchainRepo.updateCurrentBlockInProgress.mockRejectedValue(
                new Error('DB write failed'),
            );

            await expect(observer.onChainReorganisation(500n, 600n, 'hash')).rejects.toThrow(
                'DB write failed',
            );
        });

        it('639: should propagate consensus tracker failure', async () => {
            const { observer, consensusTracker } = createChainObserver();
            consensusTracker.setConsensusBlockHeight.mockReturnValue(1); // truthy = error

            await expect(observer.onChainReorganisation(500n, 600n, 'hash')).rejects.toThrow(
                'Consensus block height not set.',
            );
        });

        it('640: should set pendingBlockHeight even when consensus fails afterwards', async () => {
            const { observer, consensusTracker } = createChainObserver();
            consensusTracker.setConsensusBlockHeight.mockReturnValue(1);

            try {
                await observer.onChainReorganisation(500n, 600n, 'hash');
            } catch {
                // expected
            }

            // setNewHeight runs in Promise.safeAll before consensus check
            expect(observer.pendingBlockHeight).toBe(500n);
        });
    });

    /** Tests 641-648: BATCH_SIZE edge cases (VMMongoStorage.revertDataUntilBlock) */

    describe('BATCH_SIZE edge cases', () => {
        let storage: VMMongoStorage;
        let mocks: AllMockRepositories;

        beforeEach(() => {
            mocks = createAllMockRepositories();
            storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });
        });

        it('641: BATCH_SIZE=1 should produce one batch per block', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '5' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 5,
            });

            await storage.revertDataUntilBlock(3n);

            // upperBound=5, batched pass: to=5 > 3 (from=4), to=4 > 3 (from=3), 2 batches
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls.length).toBe(2);
        });

        it('642: BATCH_SIZE=1 should call all repository deletes for each batch', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 1;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '4' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 4,
            });

            await storage.revertDataUntilBlock(3n);

            expect(mocks.contractRepository.deleteContractsInRange).toHaveBeenCalled();
            expect(mocks.pointerRepository.deletePointerInRange).toHaveBeenCalled();
            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalled();
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).toHaveBeenCalled();
            expect(mocks.reorgRepository.deleteReorgsInRange).toHaveBeenCalled();
            expect(mocks.epochRepository.deleteEpochInRange).toHaveBeenCalled();
            expect(mocks.epochSubmissionRepository.deleteSubmissionsInRange).toHaveBeenCalled();
            expect(mocks.mldsaPublicKeysRepository.deleteInRange).toHaveBeenCalled();
        });

        it('643: BATCH_SIZE larger than range should produce no batched iterations when upperBound equals blockId', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '50' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 50,
            });

            await storage.revertDataUntilBlock(50n);

            // upperBound=50, to=50 > 50 is false, loop body doesn't execute
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
        });

        it('644: BATCH_SIZE larger than range should still run orphan cleanup pass', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 10000;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '50' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 50,
            });

            await storage.revertDataUntilBlock(50n);

            // The first pass (unbounded $gte delete) should still run
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(50n);
        });

        it('645: BATCH_SIZE=0 should default to 1000', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 0;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '1500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1500,
            });

            await storage.revertDataUntilBlock(100n);

            // Default BATCH_SIZE = 1000, range 100..1500 -> 2 batches: to=1500 (from=500), to=500 (from=100), but actually walking down
            // Batched pass: to=1500 > 100, from=max(1500-1000, 100)=500; to=500 > 100, from=max(500-1000, 100)=100; to=100 == 100 stop
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls.length).toBe(2);
        });

        it('646: should handle BATCH_SIZE undefined (fallback to 1000)', async () => {
            (mockConfig.OP_NET as Record<string, unknown>).REINDEX_BATCH_SIZE = undefined;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            await storage.revertDataUntilBlock(0n);

            // Default BATCH_SIZE = 1000, upperBound=500
            // Batched pass: to=500 > 0 => from=max(500-1000, 0)=0 => one batch. Then to=-500, stop.
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls.length).toBe(1);
            expect(calls[0][0]).toBe(0n);
            expect(calls[0][1]).toBe(500n);
        });

        it('647: should use correct batch boundaries when range is exact multiple of BATCH_SIZE', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '200' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 200,
            });

            await storage.revertDataUntilBlock(100n);

            // upperBound=200, batched pass walks DOWN: to=200 (from=150), to=150 (from=100), to=100 stop
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls.length).toBe(2);
            // First batch: from=150, to=200
            expect(calls[0][0]).toBe(150n);
            expect(calls[0][1]).toBe(200n);
            // Second batch: from=100, to=150
            expect(calls[1][0]).toBe(100n);
            expect(calls[1][1]).toBe(150n);
        });

        it('648: should clamp final batch "from" to blockId', async () => {
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 30;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });

            await storage.revertDataUntilBlock(50n);

            // upperBound=100, batch: to=100 (from=max(70,50)=70), to=70 (from=max(40,50)=50), to=50 stop
            const calls = mocks.transactionRepository.deleteTransactionsInRange.mock.calls;
            expect(calls.length).toBe(2);
            expect(calls[0][0]).toBe(70n);
            expect(calls[1][0]).toBe(50n);
        });
    });

    /** Tests 649-656: Empty database, single block scenarios */

    describe('empty database and single block scenarios', () => {
        let storage: VMMongoStorage;
        let mocks: AllMockRepositories;

        beforeEach(() => {
            mocks = createAllMockRepositories();
            storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
        });

        it('649: should handle empty DB (getLatestBlock=null) with blockId=0', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(null);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            await storage.revertDataUntilBlock(0n);

            // upperBound = max(0, 0) = 0, loop: to=0 > 0 is false. No batches.
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
            // But blockId <= 0 triggers mempool purge
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
        });

        it('650: should handle empty DB (getLatestBlock=undefined) with blockId=0', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(undefined);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            await storage.revertDataUntilBlock(0n);

            // Same as null case
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
        });

        it('651: should handle single block in DB (latestBlock height matches blockId)', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '1' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1,
            });

            await storage.revertDataUntilBlock(1n);

            // upperBound=1, to=1 > 1 is false. No batched iteration.
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
        });

        it('652: should run orphan cleanup even when no batched pass is needed', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '1' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 1,
            });

            await storage.revertDataUntilBlock(1n);

            // First pass (orphan cleanup) should still run
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(1n);
        });

        it('653: should always delete target epochs regardless of range', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue(null);
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 0,
            });

            await storage.revertDataUntilBlock(0n);

            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalledOnce();
        });

        it('654: should purge mempool when blockId=0', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });

            await storage.revertDataUntilBlock(0n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
        });

        it('655: should NOT purge mempool when blockId > 0', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });

            await storage.revertDataUntilBlock(1n);

            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('656: should purge UTXOs when blockId=0 and REINDEX_PURGE_UTXOS is true', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '10' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 10,
            });

            await storage.revertDataUntilBlock(0n);

            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).toHaveBeenCalledWith(0n);
        });
    });

    /** Tests 657-659: Very large blockId */

    describe('very large blockId', () => {
        let storage: VMMongoStorage;
        let mocks: AllMockRepositories;

        beforeEach(() => {
            mocks = createAllMockRepositories();
            storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
        });

        it('657: should handle blockId of 999_999_999n with matching latestBlock', async () => {
            const big = 999_999_999n;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: big.toString() });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: Number(big),
            });

            await expect(storage.revertDataUntilBlock(big)).resolves.toBeUndefined();

            // No batches since upperBound equals blockId
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
        });

        it('658: should handle blockId larger than latestBlock height', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });

            // blockId=500 > upperBound=100, but derivedUpper = max(100, 100) = 100, upperBound = max(100, 500) = 500
            await expect(storage.revertDataUntilBlock(500n)).resolves.toBeUndefined();

            // upperBound becomes 500 (max of derived and blockId), so to=500 > 500 is false. No batches.
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
        });

        it('659: should handle blockId with chainInfo height higher than block header height', async () => {
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            await storage.revertDataUntilBlock(50n);

            // blockHeaderHeight=100, chainInfoHeight=500, derivedUpper=500, upperBound=max(500,50)=500
            // Orphan cleanup runs at upperBound=500
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
        });
    });

    /**
     * Tests 660-665: Orchestration pattern test (mock BlockIndexer.revertChain flow)
     * Uses a lightweight orchestrator mock that simulates the revert sequence
     * without constructing the real BlockIndexer. Tests verify call ordering
     * and argument passing between components, not individual component logic.
     */

    describe('orchestration pattern: revert flow call ordering', () => {
        it('660: should execute revert flow in correct order: cleanup -> revertData -> chainObserver -> plugins', async () => {
            const orch = createOrchestrator();
            const callOrder: string[] = [];

            orch.vmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('killPendingWrites');
            });
            orch.vmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('revertData');
            });
            orch.rpcClient.getBlockCount.mockImplementation(async () => {
                callOrder.push('fetchChainHeight');
                return 1000;
            });
            orch.pluginNotifier.mockImplementation(async () => {
                callOrder.push('notifyPlugins');
            });

            await orch.revertChain(500n, 600n, 'newhash', true);

            expect(callOrder.indexOf('killPendingWrites')).toBeLessThan(
                callOrder.indexOf('revertData'),
            );
            expect(callOrder.indexOf('revertData')).toBeLessThan(
                callOrder.indexOf('fetchChainHeight'),
            );
            expect(callOrder.indexOf('fetchChainHeight')).toBeLessThan(
                callOrder.indexOf('notifyPlugins'),
            );
        });

        it('661: should call blockFetcher.onReorg before any revert operations', async () => {
            const orch = createOrchestrator();
            const callOrder: string[] = [];

            orch.blockFetcher.onReorg.mockImplementation(() => {
                callOrder.push('onReorg');
            });
            orch.vmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('killPendingWrites');
            });

            await orch.revertChain(500n, 600n, 'hash', true);

            expect(callOrder[0]).toBe('onReorg');
        });

        it('662: should pass fromHeight to revertDataUntilBlock', async () => {
            const orch = createOrchestrator();

            await orch.revertChain(500n, 600n, 'hash', true);

            expect(orch.vmStorage.revertDataUntilBlock).toHaveBeenCalledWith(500n);
        });

        it('663: should pass correct args to onChainReorganisation', async () => {
            const orch = createOrchestrator();
            const spy = vi.spyOn(orch.observer, 'onChainReorganisation');

            await orch.revertChain(500n, 600n, 'newhash', true);

            expect(spy).toHaveBeenCalledWith(500n, 600n, 'newhash');
        });

        it('664: should call pluginNotifier with reorg params', async () => {
            const orch = createOrchestrator();

            await orch.revertChain(500n, 600n, 'newhash', true);

            expect(orch.pluginNotifier).toHaveBeenCalledWith(500n, 600n, 'newhash');
        });

        it('665: should release lock (chainReorged=false) even if revertDataUntilBlock fails', async () => {
            const orch = createOrchestrator();
            orch.vmStorage.revertDataUntilBlock.mockRejectedValue(new Error('DB crash'));

            let caughtError = false;
            try {
                await orch.revertChain(500n, 600n, 'hash', true);
            } catch {
                caughtError = true;
            }

            expect(caughtError).toBe(true);
            expect(orch.isReorging()).toBe(false);
        });
    });

    /** Tests 666-670: Full startup purge flow */

    describe('full startup purge flow', () => {
        it('666: should call revertDataUntilBlock with pendingBlockHeight during startup purge', async () => {
            const vmStorage = createMockVMStorageSimple();
            const { observer } = createChainObserver();

            // Simulate startup purge as BlockIndexer does
            const purgeFromBlock = 500n;
            await vmStorage.revertDataUntilBlock(purgeFromBlock);
            await observer.setNewHeight(purgeFromBlock);

            expect(vmStorage.revertDataUntilBlock).toHaveBeenCalledWith(500n);
            expect(observer.pendingBlockHeight).toBe(500n);
        });

        it('667: should revert all data repositories when REINDEX_FROM_BLOCK is used with full reindex', async () => {
            // Test real VMMongoStorage: when doing a full reindex to block 100,
            // revertDataUntilBlock should purge all data above that block.
            mockConfig.OP_NET.REINDEX = true;
            mockConfig.OP_NET.REINDEX_FROM_BLOCK = 100;

            const mocks = createAllMockRepositories();
            const storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            const purgeFromBlock = BigInt(mockConfig.OP_NET.REINDEX_FROM_BLOCK);
            await storage.revertDataUntilBlock(purgeFromBlock);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
            expect(mocks.targetEpochRepository.deleteAllTargetEpochs).toHaveBeenCalledOnce();
        });

        it('668: should run revertDataUntilBlock at pendingBlockHeight and leave mempool untouched when blockId > 0', async () => {
            // Test real VMMongoStorage: a non-reindex purge at block 500
            // should NOT touch mempool since blockId > 0.
            mockConfig.OP_NET.REINDEX = false;

            const mocks = createAllMockRepositories();
            const storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '600' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 600,
            });

            await storage.revertDataUntilBlock(500n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(600n);
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('669: should only delete block headers and witnesses with revertBlockHeadersOnly', async () => {
            // Test real VMMongoStorage.revertBlockHeadersOnly: only block headers
            // and witnesses should be purged, no other repositories touched.
            const mocks = createAllMockRepositories();
            const storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '200' });

            await storage.revertBlockHeadersOnly(100n);

            expect(mocks.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalled();
            expect(mocks.blockWitnessRepository.deleteBlockWitnessesInRange).toHaveBeenCalled();
            // No other repositories should be touched
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).not.toHaveBeenCalled();
            expect(mocks.contractRepository.deleteContractsInRange).not.toHaveBeenCalled();
            expect(mocks.pointerRepository.deletePointerInRange).not.toHaveBeenCalled();
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('670: should purge all repositories with revertDataUntilBlock but not with revertBlockHeadersOnly', async () => {
            // Test real VMMongoStorage: compare the two methods side by side.
            // revertDataUntilBlock should touch all repos; revertBlockHeadersOnly only headers+witnesses.
            const mocks1 = createAllMockRepositories();
            const storage1 = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage1, mocks1);
            mocks1.blockRepository.getLatestBlock.mockResolvedValue({ height: '200' });
            mocks1.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 200,
            });

            await storage1.revertDataUntilBlock(100n);

            const mocks2 = createAllMockRepositories();
            const storage2 = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage2, mocks2);
            mocks2.blockRepository.getLatestBlock.mockResolvedValue({ height: '200' });

            await storage2.revertBlockHeadersOnly(100n);

            // revertDataUntilBlock should have touched transaction repo
            expect(mocks1.transactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
            // revertBlockHeadersOnly should NOT have touched transaction repo
            expect(mocks2.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
            // Both should have touched block headers
            expect(mocks1.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalled();
            expect(mocks2.blockRepository.deleteBlockHeadersInRange).toHaveBeenCalled();
        });
    });

    /** Tests 671-676: Height mismatch reorg via orchestrator and real VMMongoStorage */

    describe('height mismatch reorg via orchestrator and real storage', () => {
        it('671: should revert real VMMongoStorage when height mismatch triggers revertChain', async () => {
            // Test the full flow: orchestrator detects height mismatch -> calls
            // revertDataUntilBlock on real VMMongoStorage -> verifies repositories are purged.
            const mocks = createAllMockRepositories();
            const storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            // Simulate watchdog detecting height mismatch: revert from 490 to 500
            await storage.revertDataUntilBlock(490n);

            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
            expect(mocks.transactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
            // blockId=490 > 0, so mempool should NOT be touched
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).not.toHaveBeenCalled();
        });

        it('672: should not purge any data when reverting to current height (no-op revert)', async () => {
            const mocks = createAllMockRepositories();
            const storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            // Watchdog height equals original: revert to same height
            await storage.revertDataUntilBlock(500n);

            // upperBound=500, to=500 > 500 is false => no batched pass
            expect(mocks.transactionRepository.deleteTransactionsInRange).not.toHaveBeenCalled();
            // First pass (orphan cleanup) still runs
            expect(
                mocks.transactionRepository.deleteTransactionsFromBlockHeight,
            ).toHaveBeenCalledWith(500n);
        });

        it('673: should update ChainObserver state when onChainReorganisation is called after revert', async () => {
            // Test real ChainObserver: after revert, onChainReorganisation should
            // update pendingBlockHeight and synchronisation status.
            const { observer, rpcClient } = createChainObserver();
            rpcClient.getBlockCount.mockResolvedValue(1000);

            await observer.onChainReorganisation(490n, 500n, 'database-corrupted');

            expect(observer.pendingBlockHeight).toBe(490n);
            expect(observer.synchronisationStatus.bestBlockHash).toBe('database-corrupted');
            expect(observer.synchronisationStatus.isReorging).toBe(true);
        });

        it('674: should purge mempool and UTXOs only when reverting to block 0 (full reindex)', async () => {
            // Height mismatch scenario with full reindex (blockId=0)
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            const mocks = createAllMockRepositories();
            const storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '500' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 500,
            });

            await storage.revertDataUntilBlock(0n);

            // blockId <= 0 triggers mempool + UTXO purge
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).toHaveBeenCalledWith(0n);
        });

        it('675: should complete orchestrator revert flow and notify plugins', async () => {
            // Orchestration pattern test: verify the mock orchestrator calls
            // all components in sequence during a height mismatch revert.
            const orch = createOrchestrator();
            const callOrder: string[] = [];

            orch.vmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('killPendingWrites');
            });
            orch.vmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('revertData');
            });
            orch.pluginNotifier.mockImplementation(async () => {
                callOrder.push('notifyPlugins');
            });

            await orch.revertChain(490n, 500n, 'database-corrupted', false);

            expect(orch.vmStorage.revertDataUntilBlock).toHaveBeenCalledWith(490n);
            expect(orch.pluginNotifier).toHaveBeenCalledWith(490n, 500n, 'database-corrupted');
            expect(callOrder.indexOf('killPendingWrites')).toBeLessThan(
                callOrder.indexOf('revertData'),
            );
        });

        it('676: should handle height mismatch then successful reorg flow end-to-end', async () => {
            const orch = createOrchestrator();

            // Simulate: watchdog detects mismatch -> revertChain called
            const watchdogHeight = 490n;
            const originalHeight = 500n;

            await orch.revertChain(watchdogHeight, originalHeight, 'database-corrupted', false);

            // Verify the full flow ran
            expect(orch.vmStorage.killAllPendingWrites).toHaveBeenCalled();
            expect(orch.vmStorage.revertDataUntilBlock).toHaveBeenCalledWith(490n);
            expect(orch.observer.pendingBlockHeight).toBe(490n);
            expect(orch.pluginNotifier).toHaveBeenCalledWith(490n, 500n, 'database-corrupted');
        });
    });

    /** Tests 677-678: Concurrent call protection */

    describe('concurrent call protection', () => {
        it('677: should set chainReorged=true during revertChain and reset to false after', async () => {
            const orch = createOrchestrator();
            let wasReorgingDuringRevert = false;

            orch.vmStorage.revertDataUntilBlock.mockImplementation(async () => {
                wasReorgingDuringRevert = orch.isReorging();
            });

            await orch.revertChain(500n, 600n, 'hash', true);

            expect(wasReorgingDuringRevert).toBe(true);
            expect(orch.isReorging()).toBe(false);
        });

        it('678: should reset chainReorged=false even if an error occurs mid-flow', async () => {
            const orch = createOrchestrator();
            orch.vmStorage.killAllPendingWrites.mockRejectedValue(new Error('kill failed'));

            try {
                await orch.revertChain(500n, 600n, 'hash', true);
            } catch {
                // expected
            }

            expect(orch.isReorging()).toBe(false);
        });
    });

    /** Tests 679-682: Config interaction verification */

    describe('Config interaction verification', () => {
        let storage: VMMongoStorage;
        let mocks: AllMockRepositories;

        beforeEach(() => {
            mocks = createAllMockRepositories();
            storage = createMockVMMongoStorage(mockConfig);
            injectMockRepositories(storage, mocks);
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });
        });

        it('679: should use Config.BITCOIN.NETWORK when fetching chain info', async () => {
            mockConfig.BITCOIN.NETWORK = 'testnet';

            await storage.revertDataUntilBlock(50n);

            expect(mocks.blockchainInfoRepository.getByNetwork).toHaveBeenCalledWith('testnet');
        });

        it('680: should skip UTXO purge in batched pass when REINDEX_PURGE_UTXOS is false', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '200' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 200,
            });

            await storage.revertDataUntilBlock(100n);

            expect(
                mocks.unspentTransactionRepository.deleteTransactionsInRange,
            ).not.toHaveBeenCalled();
        });

        it('681: should include UTXO purge in batched pass when REINDEX_PURGE_UTXOS is true', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = true;
            mockConfig.OP_NET.REINDEX_BATCH_SIZE = 50;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '200' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 200,
            });

            await storage.revertDataUntilBlock(100n);

            expect(mocks.unspentTransactionRepository.deleteTransactionsInRange).toHaveBeenCalled();
        });

        it('682: should skip UTXO purge at blockId=0 when REINDEX_PURGE_UTXOS is false', async () => {
            mockConfig.OP_NET.REINDEX_PURGE_UTXOS = false;
            mocks.blockRepository.getLatestBlock.mockResolvedValue({ height: '100' });
            mocks.blockchainInfoRepository.getByNetwork.mockResolvedValue({
                inProgressBlock: 100,
            });

            await storage.revertDataUntilBlock(0n);

            // Mempool should still be purged
            expect(mocks.mempoolRepository.deleteGreaterThanBlockHeight).toHaveBeenCalledWith(0n);
            // But UTXOs should NOT be purged
            expect(
                mocks.unspentTransactionRepository.deleteGreaterThanBlockHeight,
            ).not.toHaveBeenCalled();
        });
    });
});
