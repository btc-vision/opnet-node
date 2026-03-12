import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainObserver } from '../../../src/src/blockchain-indexer/processor/observer/ChainObserver.js';

vi.mock('../../../src/src/config/Config.js', () => ({
    Config: {
        OP_NET: { REINDEX: false, REINDEX_FROM_BLOCK: 0 },
        BITCOIN: { NETWORK: 'regtest' },
    },
}));

function createMockRpcClient() {
    return {
        getBlockCount: vi.fn().mockResolvedValue(1000),
        getChainInfo: vi.fn(),
        getBlockHash: vi.fn(),
    };
}

function createMockConsensusTracker() {
    return { setConsensusBlockHeight: vi.fn().mockReturnValue(0) }; // 0 = falsy = success
}

function createMockDatabase() {
    return { db: {} };
}

function createMockVMStorage() {
    return { getBlockHeader: vi.fn(), blockchainRepository: {} };
}

function createObserver(
    overrides: {
        rpcClient?: ReturnType<typeof createMockRpcClient>;
        consensusTracker?: ReturnType<typeof createMockConsensusTracker>;
        database?: ReturnType<typeof createMockDatabase>;
        vmStorage?: ReturnType<typeof createMockVMStorage>;
    } = {},
) {
    const rpcClient = overrides.rpcClient ?? createMockRpcClient();
    const consensusTracker = overrides.consensusTracker ?? createMockConsensusTracker();
    const database = overrides.database ?? createMockDatabase();
    const vmStorage = overrides.vmStorage ?? createMockVMStorage();

    const observer = new ChainObserver(
        'regtest' as never,
        database as never,
        rpcClient as never,
        consensusTracker as never,
        vmStorage as never,
    );

    // Inject private repositories that would normally be set by init()
    (observer as Record<string, unknown>)._blockchainRepository = {
        updateCurrentBlockInProgress: vi.fn().mockResolvedValue(undefined),
    };
    (observer as Record<string, unknown>)._blocks = {
        getBlockHeader: vi.fn(),
    };

    return { observer, rpcClient, consensusTracker, database, vmStorage };
}

describe('ChainObserver.onChainReorganisation', () => {
    let observer: ChainObserver;
    let rpcClient: ReturnType<typeof createMockRpcClient>;
    let consensusTracker: ReturnType<typeof createMockConsensusTracker>;

    beforeEach(() => {
        vi.clearAllMocks();
        const ctx = createObserver();
        observer = ctx.observer;
        rpcClient = ctx.rpcClient;
        consensusTracker = ctx.consensusTracker;
    });

    // ---------------------------------------------------------------
    // Tests 601-604: State mutations
    // ---------------------------------------------------------------

    describe('state mutations', () => {
        it('601: should set isReorging to true immediately', async () => {
            expect(observer.synchronisationStatus.isReorging).toBe(false);

            await observer.onChainReorganisation(500n, 600n, 'abc123');

            expect(observer.synchronisationStatus.isReorging).toBe(true);
        });

        it('602: should update bestBlockHash to newBest', async () => {
            expect(observer.synchronisationStatus.bestBlockHash).toBeNull();

            await observer.onChainReorganisation(500n, 600n, 'newbesthash');

            expect(observer.synchronisationStatus.bestBlockHash).toBe('newbesthash');
        });

        it('603: should set targetBlockHeight from fetched chain height', async () => {
            rpcClient.getBlockCount.mockResolvedValue(2000);

            await observer.onChainReorganisation(500n, 600n, 'abc');

            expect(observer.targetBlockHeight).toBe(2000n);
        });

        it('604: should set nextBestTip (bestTip) to fromHeight', async () => {
            await observer.onChainReorganisation(500n, 600n, 'abc');

            expect(observer.synchronisationStatus.bestTip).toBe(500n);
        });
    });

    // ---------------------------------------------------------------
    // Tests 605-606: setNewHeight
    // ---------------------------------------------------------------

    describe('setNewHeight', () => {
        it('605: should set pendingBlockHeight to fromHeight via setNewHeight', async () => {
            await observer.onChainReorganisation(350n, 400n, 'hash');

            expect(observer.pendingBlockHeight).toBe(350n);
        });

        it('606: should call updateCurrentBlockInProgress with pendingBlockHeight + 1', async () => {
            const blockchainRepo = (observer as Record<string, unknown>)._blockchainRepository as {
                updateCurrentBlockInProgress: ReturnType<typeof vi.fn>;
            };

            await observer.onChainReorganisation(350n, 400n, 'hash');

            expect(blockchainRepo.updateCurrentBlockInProgress).toHaveBeenCalledWith(
                'regtest',
                351, // Number(350n + 1n)
            );
        });

        it('607: should allow calling setNewHeight directly to update height and DB', async () => {
            const blockchainRepo = (observer as Record<string, unknown>)._blockchainRepository as {
                updateCurrentBlockInProgress: ReturnType<typeof vi.fn>;
            };

            await observer.setNewHeight(777n);

            expect(observer.pendingBlockHeight).toBe(777n);
            expect(blockchainRepo.updateCurrentBlockInProgress).toHaveBeenCalledWith(
                'regtest',
                778, // Number(777n + 1n)
            );
        });
    });

    // ---------------------------------------------------------------
    // Tests 608-609: Consensus tracker
    // ---------------------------------------------------------------

    describe('consensus tracker', () => {
        it('608: should call setConsensusBlockHeight with fromHeight', async () => {
            await observer.onChainReorganisation(500n, 600n, 'abc');

            expect(consensusTracker.setConsensusBlockHeight).toHaveBeenCalledWith(500n);
        });

        it('609: should throw when setConsensusBlockHeight returns truthy (failure)', async () => {
            consensusTracker.setConsensusBlockHeight.mockReturnValue(1); // truthy = failure

            await expect(observer.onChainReorganisation(500n, 600n, 'abc')).rejects.toThrow(
                'Consensus block height not set.',
            );
        });
    });

    // ---------------------------------------------------------------
    // Tests 610-612: fetchChainHeight
    // ---------------------------------------------------------------

    describe('fetchChainHeight', () => {
        it('610: should call rpcClient.getBlockCount', async () => {
            await observer.onChainReorganisation(100n, 200n, 'hash');

            expect(rpcClient.getBlockCount).toHaveBeenCalledOnce();
        });

        it('611: should throw when getBlockCount returns null', async () => {
            rpcClient.getBlockCount.mockResolvedValue(null);

            await expect(observer.onChainReorganisation(100n, 200n, 'hash')).rejects.toThrow(
                'Chain height not found.',
            );
        });

        it('612: should throw when getBlockCount returns undefined', async () => {
            rpcClient.getBlockCount.mockResolvedValue(undefined);

            await expect(observer.onChainReorganisation(100n, 200n, 'hash')).rejects.toThrow(
                'Chain height not found.',
            );
        });
    });

    // ---------------------------------------------------------------
    // Tests 613-615: Argument validation
    // ---------------------------------------------------------------

    describe('argument validation', () => {
        it('613: should throw when fromHeight is 0n', async () => {
            await expect(observer.onChainReorganisation(0n, 100n, 'hash')).rejects.toThrow(
                'Invalid from height.',
            );
        });

        it('614: should still set isReorging to true even when fromHeight is 0n', async () => {
            try {
                await observer.onChainReorganisation(0n, 100n, 'hash');
            } catch {
                // expected
            }

            expect(observer.synchronisationStatus.isReorging).toBe(true);
        });

        it('615: should accept fromHeight of 1n (minimum valid height)', async () => {
            await expect(observer.onChainReorganisation(1n, 100n, 'hash')).resolves.toBeUndefined();
        });
    });

    // ---------------------------------------------------------------
    // Tests 616-617: Parallel execution (fetchChainHeight + setNewHeight)
    // ---------------------------------------------------------------

    describe('parallel execution', () => {
        it('616: should run fetchChainHeight and setNewHeight concurrently via Promise.safeAll', async () => {
            let fetchStarted = false;
            let setNewHeightStarted = false;
            let bothRunningConcurrently = false;

            rpcClient.getBlockCount.mockImplementation(async () => {
                fetchStarted = true;
                // Check if setNewHeight also started (parallel)
                await new Promise((r) => setTimeout(r, 10));
                if (setNewHeightStarted) {
                    bothRunningConcurrently = true;
                }
                return 1000;
            });

            const blockchainRepo = (observer as Record<string, unknown>)._blockchainRepository as {
                updateCurrentBlockInProgress: ReturnType<typeof vi.fn>;
            };
            blockchainRepo.updateCurrentBlockInProgress.mockImplementation(async () => {
                setNewHeightStarted = true;
                await new Promise((r) => setTimeout(r, 10));
            });

            await observer.onChainReorganisation(500n, 600n, 'hash');

            expect(fetchStarted).toBe(true);
            expect(setNewHeightStarted).toBe(true);
            expect(bothRunningConcurrently).toBe(true);
        });

        it('617: should propagate errors from either parallel task', async () => {
            rpcClient.getBlockCount.mockRejectedValue(new Error('RPC connection failed'));

            await expect(observer.onChainReorganisation(500n, 600n, 'hash')).rejects.toThrow(
                'RPC connection failed',
            );
        });
    });

    // ---------------------------------------------------------------
    // Tests 618-621: updateStatus
    // ---------------------------------------------------------------

    describe('updateStatus', () => {
        it('618: should set isDownloading=true when pendingBlockHeight < targetBlockHeight', async () => {
            rpcClient.getBlockCount.mockResolvedValue(2000);

            await observer.onChainReorganisation(500n, 600n, 'hash');

            // pending=500, target=2000 -> downloading
            expect(observer.synchronisationStatus.isDownloading).toBe(true);
        });

        it('619: should set isDownloading=false when pendingBlockHeight >= targetBlockHeight', async () => {
            rpcClient.getBlockCount.mockResolvedValue(500);

            await observer.onChainReorganisation(500n, 600n, 'hash');

            // pending=500, target=500 -> not downloading
            expect(observer.synchronisationStatus.isDownloading).toBe(false);
        });

        it('620: should set isSyncing=true when pendingBlockHeight !== targetBlockHeight', async () => {
            rpcClient.getBlockCount.mockResolvedValue(2000);

            await observer.onChainReorganisation(500n, 600n, 'hash');

            expect(observer.synchronisationStatus.isSyncing).toBe(true);
        });

        it('621: should set isSyncing=false when pendingBlockHeight === targetBlockHeight', async () => {
            rpcClient.getBlockCount.mockResolvedValue(500);

            await observer.onChainReorganisation(500n, 600n, 'hash');

            // pending=500, target=500 -> synced
            expect(observer.synchronisationStatus.isSyncing).toBe(false);
        });
    });

    // ---------------------------------------------------------------
    // Tests 622-625: Various parameter values
    // ---------------------------------------------------------------

    describe('various parameter values', () => {
        it('622: should handle very large fromHeight', async () => {
            rpcClient.getBlockCount.mockResolvedValue(Number(999_999_999n));

            await observer.onChainReorganisation(999_999_000n, 999_999_999n, 'largehash');

            expect(observer.pendingBlockHeight).toBe(999_999_000n);
            expect(observer.targetBlockHeight).toBe(999_999_999n);
        });

        it('623: should handle fromHeight equal to toHeight', async () => {
            await observer.onChainReorganisation(500n, 500n, 'samehash');

            expect(observer.pendingBlockHeight).toBe(500n);
            expect(observer.synchronisationStatus.bestBlockHash).toBe('samehash');
        });

        it('624: should handle empty newBest string', async () => {
            await observer.onChainReorganisation(500n, 600n, '');

            expect(observer.synchronisationStatus.bestBlockHash).toBe('');
        });

        it('625: should handle very long newBest hash string', async () => {
            const longHash = 'a'.repeat(256);

            await observer.onChainReorganisation(500n, 600n, longHash);

            expect(observer.synchronisationStatus.bestBlockHash).toBe(longHash);
        });
    });

    // ---------------------------------------------------------------
    // Tests 626-628: onBlockChange
    // ---------------------------------------------------------------

    describe('onBlockChange', () => {
        it('626: should set targetBlockHeight from blockInfo.height', () => {
            observer.onBlockChange({ height: 750, hash: 'blockhash' } as never);

            expect(observer.targetBlockHeight).toBe(750n);
        });

        it('627: should set bestBlockHash from blockInfo.hash', () => {
            observer.onBlockChange({ height: 750, hash: 'blockhash123' } as never);

            expect(observer.synchronisationStatus.bestBlockHash).toBe('blockhash123');
        });

        it('628: should call updateStatus after setting fields', () => {
            // Set pending to some known value first
            observer.pendingBlockHeight = 500n;

            observer.onBlockChange({ height: 750, hash: 'h' } as never);

            // pending=500 < target=750 -> isDownloading=true, isSyncing=true
            expect(observer.synchronisationStatus.isDownloading).toBe(true);
            expect(observer.synchronisationStatus.isSyncing).toBe(true);
        });
    });

    // ---------------------------------------------------------------
    // Tests 629-630: pendingBlockHeight and pendingTaskHeight getters/setters
    // ---------------------------------------------------------------

    describe('pendingBlockHeight and pendingTaskHeight', () => {
        it('629: should read and write pendingBlockHeight through the sync status', () => {
            observer.pendingBlockHeight = 42n;

            expect(observer.pendingBlockHeight).toBe(42n);
            expect(observer.synchronisationStatus.pendingBlockHeight).toBe(42n);
        });

        it('630: should read pendingTaskHeight (bestTip) from sync status', () => {
            observer.nextBestTip = 99n;

            expect(observer.pendingTaskHeight).toBe(99n);
            expect(observer.synchronisationStatus.bestTip).toBe(99n);
        });
    });
});
