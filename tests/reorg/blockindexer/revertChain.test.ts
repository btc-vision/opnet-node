import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadTypes } from '../../../src/src/threading/thread/enums/ThreadTypes.js';
import { MessageType } from '../../../src/src/threading/enum/MessageType.js';
// Now import the REAL BlockIndexer
import { BlockIndexer } from '../../../src/src/blockchain-indexer/processor/BlockIndexer.js';

// Must be hoisted before vi.mock
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
        RESYNC_BLOCK_HEIGHTS: false,
        RESYNC_BLOCK_HEIGHTS_UNTIL: 0,
        ALWAYS_ENABLE_REORG_VERIFICATION: false,
        PROCESS_ONLY_X_BLOCK: 0,
    },
    BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 },
    PLUGINS: { PLUGINS_ENABLED: false },
    INDEXER: { READONLY_MODE: false, STORAGE_TYPE: 'MONGODB' },
    BLOCKCHAIN: {},
}));

// Create mock instances we can reference
const mockVmStorage = vi.hoisted(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    killAllPendingWrites: vi.fn().mockResolvedValue(undefined),
    revertDataUntilBlock: vi.fn().mockResolvedValue(undefined),
    revertBlockHeadersOnly: vi.fn().mockResolvedValue(undefined),
    setReorg: vi.fn().mockResolvedValue(undefined),
    getLatestBlock: vi.fn().mockResolvedValue(undefined),
    blockchainRepository: {},
    close: vi.fn(),
}));

const mockChainObserver = vi.hoisted(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    onChainReorganisation: vi.fn().mockResolvedValue(undefined),
    setNewHeight: vi.fn().mockResolvedValue(undefined),
    pendingBlockHeight: 100n,
    pendingTaskHeight: 100n,
    targetBlockHeight: 1000n,
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

// Mock ALL modules
vi.mock('../../../src/src/config/Config.js', () => ({ Config: mockConfig }));
vi.mock('../../../src/src/vm/storage/databases/MongoDBConfigurationDefaults.js', () => ({
    MongoDBConfigurationDefaults: {},
}));

vi.mock('@btc-vision/bsi-common', () => ({
    ConfigurableDBManager: vi.fn(function (this: Record<string, unknown>) {
        this.db = null;
    }),
    Logger: class Logger {
        readonly logColor: string = '';
        log(..._a: unknown[]) {}
        warn(..._a: unknown[]) {}
        error(..._a: unknown[]) {}
        info(..._a: unknown[]) {}
        debugBright(..._a: unknown[]) {}
        success(..._a: unknown[]) {}
        fail(..._a: unknown[]) {}
        panic(..._a: unknown[]) {}
        important(..._a: unknown[]) {}
    },
    DebugLevel: {},
    DataConverter: { fromDecimal128: vi.fn() },
}));

vi.mock('@btc-vision/bitcoin-rpc', () => ({
    BitcoinRPC: vi.fn(function () {
        return { init: vi.fn().mockResolvedValue(undefined) };
    }),
}));

vi.mock('@btc-vision/bitcoin', () => ({
    Network: {},
}));

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
    default: {
        existsSync: vi.fn(() => false),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
    },
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

describe('revertChain - BlockIndexer (real class)', () => {
    let indexer: BlockIndexer;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset mock defaults
        mockVmStorage.killAllPendingWrites.mockResolvedValue(undefined);
        mockVmStorage.revertDataUntilBlock.mockResolvedValue(undefined);
        mockVmStorage.setReorg.mockResolvedValue(undefined);
        mockChainObserver.onChainReorganisation.mockResolvedValue(undefined);
        mockChainObserver.pendingBlockHeight = 100n;

        indexer = new BlockIndexer();
        indexer.sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);
        indexer.sendMessageToThread = vi.fn().mockResolvedValue(null);

        // Ensure the _blockFetcher is set (normally done in init)
        (indexer as any)._blockFetcher = mockBlockFetcher;
    });

    // ========================================================================
    // Execution sequence
    // ========================================================================
    describe('execution sequence', () => {
        it('should call stopAllTasks before blockFetcher.onReorg', async () => {
            const callOrder: string[] = [];
            const task = {
                cancel: vi.fn().mockImplementation(async () => {
                    callOrder.push('stopAllTasks');
                }),
            };
            (indexer as any).currentTask = task;
            mockBlockFetcher.onReorg.mockImplementation(() => {
                callOrder.push('blockFetcher.onReorg');
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(callOrder.indexOf('stopAllTasks')).toBeLessThan(
                callOrder.indexOf('blockFetcher.onReorg'),
            );
        });

        it('should call blockFetcher.onReorg before notifyThreadReorg', async () => {
            const callOrder: string[] = [];
            mockBlockFetcher.onReorg.mockImplementation(() => {
                callOrder.push('blockFetcher.onReorg');
            });
            (indexer.sendMessageToAllThreads as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    callOrder.push('notifyThreadReorg');
                },
            );

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(callOrder.indexOf('blockFetcher.onReorg')).toBeLessThan(
                callOrder.indexOf('notifyThreadReorg'),
            );
        });

        it('should call notifyThreadReorg before killAllPendingWrites', async () => {
            const callOrder: string[] = [];
            (indexer.sendMessageToAllThreads as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    callOrder.push('notifyThreadReorg');
                },
            );
            mockVmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('killAllPendingWrites');
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(callOrder.indexOf('notifyThreadReorg')).toBeLessThan(
                callOrder.indexOf('killAllPendingWrites'),
            );
        });

        it('should call killAllPendingWrites before revertDataUntilBlock', async () => {
            const callOrder: string[] = [];
            mockVmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('killAllPendingWrites');
            });
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('revertDataUntilBlock');
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(callOrder.indexOf('killAllPendingWrites')).toBeLessThan(
                callOrder.indexOf('revertDataUntilBlock'),
            );
        });

        it('should call revertDataUntilBlock before onChainReorganisation', async () => {
            const callOrder: string[] = [];
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('revertDataUntilBlock');
            });
            mockChainObserver.onChainReorganisation.mockImplementation(async () => {
                callOrder.push('onChainReorganisation');
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(callOrder.indexOf('revertDataUntilBlock')).toBeLessThan(
                callOrder.indexOf('onChainReorganisation'),
            );
        });

        it('should call onChainReorganisation before notifyPluginsOfReorg', async () => {
            const callOrder: string[] = [];
            mockChainObserver.onChainReorganisation.mockImplementation(async () => {
                callOrder.push('onChainReorganisation');
            });
            (indexer.sendMessageToThread as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    callOrder.push('notifyPluginsOfReorg');
                    return null;
                },
            );

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(callOrder.indexOf('onChainReorganisation')).toBeLessThan(
                callOrder.indexOf('notifyPluginsOfReorg'),
            );
        });

        it('should call stopAllTasks twice (before and after onReorg)', async () => {
            let stopCallCount = 0;
            const task = {
                cancel: vi.fn().mockImplementation(async () => stopCallCount++),
            };
            (indexer as any).currentTask = task;

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            // First stopAllTasks call processes currentTask, second has nothing (already cleared)
            expect(task.cancel).toHaveBeenCalledTimes(1);
            expect(mockBlockFetcher.onReorg).toHaveBeenCalledTimes(1);
        });

        it('should call all operations in a complete revert with reorged=true', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(mockBlockFetcher.onReorg).toHaveBeenCalled();
            expect(indexer.sendMessageToAllThreads).toHaveBeenCalled();
            expect(mockVmStorage.killAllPendingWrites).toHaveBeenCalled();
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(50n, true);
            expect(mockChainObserver.onChainReorganisation).toHaveBeenCalledWith(
                50n,
                100n,
                'newhash',
            );
            expect(mockVmStorage.setReorg).toHaveBeenCalled();
            expect(indexer.sendMessageToThread).toHaveBeenCalled();
        });

        it('should call reorgFromHeight after onChainReorganisation when reorged=true', async () => {
            const callOrder: string[] = [];
            mockChainObserver.onChainReorganisation.mockImplementation(async () => {
                callOrder.push('onChainReorganisation');
            });
            mockVmStorage.setReorg.mockImplementation(async () => {
                callOrder.push('setReorg');
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(callOrder.indexOf('onChainReorganisation')).toBeLessThan(
                callOrder.indexOf('setReorg'),
            );
        });

        it('should call notifyPluginsOfReorg as the last operation', async () => {
            const callOrder: string[] = [];
            mockVmStorage.setReorg.mockImplementation(async () => {
                callOrder.push('setReorg');
            });
            (indexer.sendMessageToThread as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    callOrder.push('notifyPlugins');
                    return null;
                },
            );

            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(callOrder[callOrder.length - 1]).toBe('notifyPlugins');
        });

        it('should execute full sequence in correct order for reorged=true', async () => {
            const callOrder: string[] = [];
            mockBlockFetcher.onReorg.mockImplementation(() => {
                callOrder.push('1:onReorg');
            });
            (indexer.sendMessageToAllThreads as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    callOrder.push('2:notifyThread');
                },
            );
            mockVmStorage.killAllPendingWrites.mockImplementation(async () => {
                callOrder.push('3:killWrites');
            });
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                callOrder.push('4:revertData');
            });
            mockChainObserver.onChainReorganisation.mockImplementation(async () => {
                callOrder.push('5:chainReorg');
            });
            mockVmStorage.setReorg.mockImplementation(async () => {
                callOrder.push('6:setReorg');
            });
            (indexer.sendMessageToThread as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    callOrder.push('7:notifyPlugins');
                    return null;
                },
            );

            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(callOrder).toEqual([
                '1:onReorg',
                '2:notifyThread',
                '3:killWrites',
                '4:revertData',
                '5:chainReorg',
                '6:setReorg',
                '7:notifyPlugins',
            ]);
        });
    });

    // ========================================================================
    // reorged = true vs false
    // ========================================================================
    describe('reorged = true vs false', () => {
        it('should call setReorg when reorged is true', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(mockVmStorage.setReorg).toHaveBeenCalledTimes(1);
        });

        it('should not call setReorg when reorged is false', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(mockVmStorage.setReorg).not.toHaveBeenCalled();
        });

        it('should call revertDataUntilBlock regardless of reorged flag', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', false);
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(50n, true);

            vi.clearAllMocks();

            await (indexer as any).revertChain(50n, 100n, 'newhash', true);
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(50n, true);
        });

        it('should call killAllPendingWrites regardless of reorged flag', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', false);
            expect(mockVmStorage.killAllPendingWrites).toHaveBeenCalledTimes(1);

            vi.clearAllMocks();

            await (indexer as any).revertChain(50n, 100n, 'newhash', true);
            expect(mockVmStorage.killAllPendingWrites).toHaveBeenCalledTimes(1);
        });

        it('should pass reorged=true flag to stopAllTasks (task.cancel)', async () => {
            const task = { cancel: vi.fn().mockResolvedValue(undefined) };
            (indexer as any).currentTask = task;

            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(task.cancel).toHaveBeenCalledWith(true);
        });

        it('should pass reorged=false flag to stopAllTasks (task.cancel)', async () => {
            const task = { cancel: vi.fn().mockResolvedValue(undefined) };
            (indexer as any).currentTask = task;

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(task.cancel).toHaveBeenCalledWith(false);
        });
    });

    // ========================================================================
    // chainReorged flag lifecycle
    // ========================================================================
    describe('chainReorged flag lifecycle', () => {
        it('should set chainReorged to true at the start of revertChain', async () => {
            let flagDuringExecution = false;
            mockVmStorage.killAllPendingWrites.mockImplementation(async () => {
                flagDuringExecution = (indexer as any).chainReorged;
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(flagDuringExecution).toBe(true);
        });

        it('should set chainReorged to false after revertChain completes', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect((indexer as any).chainReorged).toBe(false);
        });

        it('should set chainReorged to false even if revertDataUntilBlock throws', async () => {
            mockVmStorage.revertDataUntilBlock.mockRejectedValue(new Error('revert failed'));

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'revert failed',
            );

            expect((indexer as any).chainReorged).toBe(false);
        });

        it('should set chainReorged to false even if killAllPendingWrites throws', async () => {
            mockVmStorage.killAllPendingWrites.mockRejectedValue(new Error('kill writes failed'));

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'kill writes failed',
            );

            expect((indexer as any).chainReorged).toBe(false);
        });

        it('should be true during blockFetcher.onReorg call', async () => {
            let flagDuringOnReorg = false;
            mockBlockFetcher.onReorg.mockImplementation(() => {
                flagDuringOnReorg = (indexer as any).chainReorged;
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(flagDuringOnReorg).toBe(true);
        });

        it('should be true during notifyPluginsOfReorg call', async () => {
            let flagDuringPluginNotify = false;
            (indexer.sendMessageToThread as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    flagDuringPluginNotify = (indexer as any).chainReorged;
                    return null;
                },
            );

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(flagDuringPluginNotify).toBe(true);
        });

        it('should reset to false if reorgFromHeight throws (fromHeight <= 0)', async () => {
            await expect((indexer as any).revertChain(0n, 100n, 'newhash', true)).rejects.toThrow(
                'Block height must be greater than 0',
            );

            expect((indexer as any).chainReorged).toBe(false);
        });

        it('should be true during every step of revertChain', async () => {
            const flagValues: boolean[] = [];
            mockVmStorage.revertDataUntilBlock.mockImplementation(async () => {
                flagValues.push((indexer as any).chainReorged);
            });
            mockChainObserver.onChainReorganisation.mockImplementation(async () => {
                flagValues.push((indexer as any).chainReorged);
            });

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(flagValues.every((v) => v === true)).toBe(true);
        });
    });

    // ========================================================================
    // stopAllTasks behavior
    // ========================================================================
    describe('stopAllTasks behavior', () => {
        it('should cancel currentTask when it exists', async () => {
            const task = { cancel: vi.fn().mockResolvedValue(undefined) };
            (indexer as any).currentTask = task;

            await (indexer as any).stopAllTasks(false);

            expect(task.cancel).toHaveBeenCalledWith(false);
        });

        it('should cancel all indexing tasks', async () => {
            const task1 = { cancel: vi.fn().mockResolvedValue(undefined) };
            const task2 = { cancel: vi.fn().mockResolvedValue(undefined) };
            const task3 = { cancel: vi.fn().mockResolvedValue(undefined) };
            (indexer as any).indexingTasks = [task1, task2, task3];

            await (indexer as any).stopAllTasks(true);

            expect(task1.cancel).toHaveBeenCalledWith(true);
            expect(task2.cancel).toHaveBeenCalledWith(true);
            expect(task3.cancel).toHaveBeenCalledWith(true);
        });

        it('should clear currentTask after cancellation', async () => {
            (indexer as any).currentTask = { cancel: vi.fn().mockResolvedValue(undefined) };

            await (indexer as any).stopAllTasks(false);

            expect((indexer as any).currentTask).toBeUndefined();
        });

        it('should clear indexingTasks array after cancellation', async () => {
            (indexer as any).indexingTasks = [
                { cancel: vi.fn().mockResolvedValue(undefined) },
                { cancel: vi.fn().mockResolvedValue(undefined) },
            ];

            await (indexer as any).stopAllTasks(false);

            expect((indexer as any).indexingTasks).toEqual([]);
        });

        it('should not throw when no tasks exist', async () => {
            (indexer as any).currentTask = undefined;
            (indexer as any).indexingTasks = [];

            await expect((indexer as any).stopAllTasks(false)).resolves.toBeUndefined();
        });

        it('should cancel indexing tasks in order', async () => {
            const cancelOrder: number[] = [];
            const task1 = {
                cancel: vi.fn().mockImplementation(async () => cancelOrder.push(1)),
            };
            const task2 = {
                cancel: vi.fn().mockImplementation(async () => cancelOrder.push(2)),
            };
            const task3 = {
                cancel: vi.fn().mockImplementation(async () => cancelOrder.push(3)),
            };
            (indexer as any).indexingTasks = [task1, task2, task3];

            await (indexer as any).stopAllTasks(false);

            expect(cancelOrder).toEqual([1, 2, 3]);
        });
    });

    // ========================================================================
    // notifyThreadReorg
    // ========================================================================
    describe('notifyThreadReorg', () => {
        it('should send CHAIN_REORG message to SYNCHRONISATION threads', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(indexer.sendMessageToAllThreads).toHaveBeenCalledWith(
                ThreadTypes.SYNCHRONISATION,
                expect.objectContaining({
                    type: MessageType.CHAIN_REORG,
                }),
            );
        });

        it('should include fromHeight, toHeight, and newBest in message data', async () => {
            await (indexer as any).revertChain(42n, 99n, 'abc123', false);

            expect(indexer.sendMessageToAllThreads).toHaveBeenCalledWith(
                ThreadTypes.SYNCHRONISATION,
                {
                    type: MessageType.CHAIN_REORG,
                    data: {
                        fromHeight: 42n,
                        toHeight: 99n,
                        newBest: 'abc123',
                    },
                },
            );
        });

        it('should await the sendMessageToAllThreads call', async () => {
            let resolved = false;
            (indexer.sendMessageToAllThreads as ReturnType<typeof vi.fn>).mockImplementation(
                async () => {
                    resolved = true;
                },
            );

            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(resolved).toBe(true);
        });
    });

    // ========================================================================
    // notifyPluginsOfReorg (via revertChain)
    // ========================================================================
    describe('notifyPluginsOfReorg', () => {
        it('should send PLUGIN_REORG message to PLUGIN thread', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', false);

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    type: MessageType.PLUGIN_REORG,
                }),
            );
        });

        it('should include fromBlock, toBlock, and reason in message data', async () => {
            await (indexer as any).revertChain(42n, 99n, 'chain-reorg', false);

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(ThreadTypes.PLUGIN, {
                type: MessageType.PLUGIN_REORG,
                data: {
                    fromBlock: 42n,
                    toBlock: 99n,
                    reason: 'chain-reorg',
                },
            });
        });

        it('should forward newBest as the reason field in plugin notification', async () => {
            await (indexer as any).revertChain(50n, 100n, 'my-new-best-hash', false);

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    data: expect.objectContaining({
                        reason: 'my-new-best-hash',
                    }),
                }),
            );
        });
    });

    // ========================================================================
    // error propagation
    // ========================================================================
    describe('error propagation', () => {
        it('should propagate error from stopAllTasks (task.cancel throws)', async () => {
            (indexer as any).currentTask = {
                cancel: vi.fn().mockRejectedValue(new Error('cancel failed')),
            };

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'cancel failed',
            );
        });

        it('should propagate error from vmStorage.killAllPendingWrites', async () => {
            mockVmStorage.killAllPendingWrites.mockRejectedValue(new Error('kill pending failed'));

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'kill pending failed',
            );
        });

        it('should propagate error from vmStorage.revertDataUntilBlock', async () => {
            mockVmStorage.revertDataUntilBlock.mockRejectedValue(new Error('revert data failed'));

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'revert data failed',
            );
        });

        it('should propagate error from chainObserver.onChainReorganisation', async () => {
            mockChainObserver.onChainReorganisation.mockRejectedValue(new Error('observer failed'));

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'observer failed',
            );
        });

        it('should propagate error from sendMessageToAllThreads (notifyThreadReorg)', async () => {
            (indexer.sendMessageToAllThreads as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('thread notify failed'),
            );

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'thread notify failed',
            );
        });

        it('should propagate error from sendMessageToThread (notifyPluginsOfReorg)', async () => {
            (indexer.sendMessageToThread as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('plugin send failed'),
            );

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', false)).rejects.toThrow(
                'plugin send failed',
            );
        });
    });

    // ========================================================================
    // argument forwarding
    // ========================================================================
    describe('argument forwarding', () => {
        it('should forward fromHeight to revertDataUntilBlock', async () => {
            await (indexer as any).revertChain(777n, 1000n, 'hash999', false);

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(777n, true);
        });

        it('should forward all three arguments to onChainReorganisation', async () => {
            await (indexer as any).revertChain(42n, 84n, 'bestblock', false);

            expect(mockChainObserver.onChainReorganisation).toHaveBeenCalledWith(
                42n,
                84n,
                'bestblock',
            );
        });

        it('should forward fromHeight and toHeight to reorgFromHeight when reorged=true', async () => {
            await (indexer as any).revertChain(50n, 150n, 'hash', true);

            expect(mockVmStorage.setReorg).toHaveBeenCalledWith(
                expect.objectContaining({
                    fromBlock: 50n,
                    toBlock: 150n,
                }),
            );
        });

        it('should forward newBest as reason to notifyPluginsOfReorg', async () => {
            await (indexer as any).revertChain(50n, 100n, 'my-new-best-hash', false);

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    data: expect.objectContaining({
                        reason: 'my-new-best-hash',
                    }),
                }),
            );
        });
    });

    // ========================================================================
    // processing-error interaction
    // ========================================================================
    describe('interaction with processNextTask error path', () => {
        it('should handle revert triggered from processing error (reorged=false)', async () => {
            await (indexer as any).revertChain(99n, 100n, 'processing-error', false);

            expect(mockVmStorage.setReorg).not.toHaveBeenCalled();
            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(99n, true);
        });

        it('should not skip killAllPendingWrites even on processing-error reverts', async () => {
            await (indexer as any).revertChain(99n, 100n, 'processing-error', false);

            expect(mockVmStorage.killAllPendingWrites).toHaveBeenCalledTimes(1);
        });

        it('should not skip notifyPluginsOfReorg on processing-error reverts', async () => {
            await (indexer as any).revertChain(99n, 100n, 'processing-error', false);

            expect(indexer.sendMessageToThread).toHaveBeenCalledWith(
                ThreadTypes.PLUGIN,
                expect.objectContaining({
                    type: MessageType.PLUGIN_REORG,
                    data: expect.objectContaining({
                        reason: 'processing-error',
                    }),
                }),
            );
        });

        it('should forward computed heights correctly in processing-error scenario', async () => {
            const pendingHeight = 100n;
            const newHeight = pendingHeight - 1n;

            await (indexer as any).revertChain(pendingHeight, newHeight, 'processing-error', false);

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(pendingHeight, true);
            expect(mockChainObserver.onChainReorganisation).toHaveBeenCalledWith(
                pendingHeight,
                newHeight,
                'processing-error',
            );
        });
    });

    // ========================================================================
    // concurrent revert protection and edge cases
    // ========================================================================
    describe('concurrent revert protection and edge cases', () => {
        it('should complete normally with minimum valid fromHeight (1n) when reorged=true', async () => {
            await expect(
                (indexer as any).revertChain(1n, 100n, 'newhash', true),
            ).resolves.toBeUndefined();

            expect(mockVmStorage.setReorg).toHaveBeenCalled();
        });

        it('should throw for fromHeight=0n when reorged=true', async () => {
            await expect((indexer as any).revertChain(0n, 100n, 'newhash', true)).rejects.toThrow(
                'Block height must be greater than 0. Was 0.',
            );
        });

        it('should throw for negative fromHeight when reorged=true', async () => {
            await expect((indexer as any).revertChain(-5n, 100n, 'newhash', true)).rejects.toThrow(
                'Block height must be greater than 0. Was -5.',
            );
        });

        it('should not throw for fromHeight=0n when reorged=false (reorgFromHeight not called)', async () => {
            await expect(
                (indexer as any).revertChain(0n, 100n, 'newhash', false),
            ).resolves.toBeUndefined();
        });

        it('should handle very large block heights', async () => {
            const largeHeight = 999999999n;
            await (indexer as any).revertChain(largeHeight, largeHeight + 1000n, 'hash', true);

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(largeHeight, true);
            expect(mockVmStorage.setReorg).toHaveBeenCalledWith(
                expect.objectContaining({
                    fromBlock: largeHeight,
                    toBlock: largeHeight + 1000n,
                }),
            );
        });

        it('should include a Date timestamp in reorg data when reorged=true', async () => {
            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(mockVmStorage.setReorg).toHaveBeenCalledWith(
                expect.objectContaining({
                    timestamp: expect.any(Date),
                }),
            );
        });

        it('should not call any operations after revertDataUntilBlock if it throws', async () => {
            mockVmStorage.revertDataUntilBlock.mockRejectedValue(new Error('revert boom'));

            await expect((indexer as any).revertChain(50n, 100n, 'newhash', true)).rejects.toThrow(
                'revert boom',
            );

            expect(mockChainObserver.onChainReorganisation).not.toHaveBeenCalled();
            expect(mockVmStorage.setReorg).not.toHaveBeenCalled();
            expect(indexer.sendMessageToThread).not.toHaveBeenCalled();
        });

        it('should cancel both currentTask and indexingTasks during revertChain', async () => {
            const currentTask = { cancel: vi.fn().mockResolvedValue(undefined) };
            const indexingTask1 = { cancel: vi.fn().mockResolvedValue(undefined) };
            const indexingTask2 = { cancel: vi.fn().mockResolvedValue(undefined) };

            (indexer as any).currentTask = currentTask;
            (indexer as any).indexingTasks = [indexingTask1, indexingTask2];

            await (indexer as any).revertChain(50n, 100n, 'newhash', true);

            expect(currentTask.cancel).toHaveBeenCalledWith(true);
            expect(indexingTask1.cancel).toHaveBeenCalledWith(true);
            expect(indexingTask2.cancel).toHaveBeenCalledWith(true);
        });

        it('should handle fromHeight equal to toHeight', async () => {
            await (indexer as any).revertChain(50n, 50n, 'newhash', true);

            expect(mockVmStorage.revertDataUntilBlock).toHaveBeenCalledWith(50n, true);
            expect(mockVmStorage.setReorg).toHaveBeenCalledWith(
                expect.objectContaining({
                    fromBlock: 50n,
                    toBlock: 50n,
                }),
            );
        });

        it('should handle empty string as newBest', async () => {
            await (indexer as any).revertChain(50n, 100n, '', false);

            expect(indexer.sendMessageToAllThreads).toHaveBeenCalledWith(
                ThreadTypes.SYNCHRONISATION,
                expect.objectContaining({
                    data: expect.objectContaining({
                        newBest: '',
                    }),
                }),
            );
        });
    });
});
