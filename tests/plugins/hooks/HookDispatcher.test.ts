import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HookDispatcher } from '../../../src/src/plugins/hooks/HookDispatcher.js';
import { PluginRegistry } from '../../../src/src/plugins/registry/PluginRegistry.js';
import { PluginWorkerPool } from '../../../src/src/plugins/workers/PluginWorkerPool.js';
import {
    HOOK_CONFIGS,
    HookExecutionMode,
    HookType,
} from '../../../src/src/plugins/interfaces/IPluginHooks.js';
import { ReindexAction } from '../../../src/src/plugins/interfaces/IPluginInstallState.js';

// Mock the Logger base class
vi.mock('@btc-vision/bsi-common', () => ({
    Logger: class {
        info = vi.fn();
        warn = vi.fn();
        error = vi.fn();
        debug = vi.fn();
    },
}));

describe('HookDispatcher', () => {
    let dispatcher: HookDispatcher;
    let mockRegistry: PluginRegistry;
    let mockWorkerPool: PluginWorkerPool;

    // Extract mock functions to avoid unbound-method warnings
    let mockGetEnabled: ReturnType<typeof vi.fn>;
    let mockGetWithPermission: ReturnType<typeof vi.fn>;
    let mockExecuteHook: ReturnType<typeof vi.fn>;
    let mockExecuteHookWithResult: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Create mock registry functions
        mockGetEnabled = vi.fn(() => []);
        mockGetWithPermission = vi.fn(() => []);
        mockRegistry = {
            getEnabled: mockGetEnabled,
            getWithPermission: mockGetWithPermission,
        } as unknown as PluginRegistry;

        // Create mock worker pool functions
        mockExecuteHook = vi.fn(() =>
            Promise.resolve({
                success: true,
                durationMs: 10,
            }),
        );
        mockExecuteHookWithResult = vi.fn(() =>
            Promise.resolve({
                success: true,
                durationMs: 10,
                result: true,
            }),
        );
        mockWorkerPool = {
            executeHook: mockExecuteHook,
            executeHookWithResult: mockExecuteHookWithResult,
        } as unknown as PluginWorkerPool;

        dispatcher = new HookDispatcher(mockRegistry, mockWorkerPool);
    });

    describe('dispatch', () => {
        it('should return empty array when no plugins registered', async () => {
            const results = await dispatcher.dispatch(HookType.BLOCK_CHANGE, {});
            expect(results).toEqual([]);
        });

        it('should use requiredPermission to filter plugins', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            await dispatcher.dispatch(HookType.BLOCK_CHANGE, {});

            expect(mockGetWithPermission).toHaveBeenCalledWith('blocks.onChange');
        });

        it('should get all enabled plugins when no permission required', async () => {
            mockGetEnabled.mockReturnValue([{ id: 'plugin-a' } as never]);

            // LOAD hook has no requiredPermission
            await dispatcher.dispatch(HookType.LOAD, undefined);

            expect(mockGetEnabled).toHaveBeenCalled();
        });

        it('should warn for unknown hook type', async () => {
            const warnSpy = vi.spyOn(dispatcher as never, 'warn');
            const results = await dispatcher.dispatch('unknown' as HookType, {});

            expect(results).toEqual([]);
            expect(warnSpy).toHaveBeenCalledWith('No configuration for hook type: unknown');
        });

        it('should execute hooks in parallel for PARALLEL mode', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
                { id: 'plugin-b' } as never,
            ]);

            const results = await dispatcher.dispatch(HookType.BLOCK_CHANGE, {});

            expect(results).toHaveLength(2);
            expect(mockExecuteHook).toHaveBeenCalledTimes(2);
        });

        it('should execute hooks sequentially for SEQUENTIAL mode', async () => {
            mockGetEnabled.mockReturnValue([
                { id: 'plugin-a' } as never,
                { id: 'plugin-b' } as never,
            ]);

            const callOrder: string[] = [];
            mockExecuteHook.mockImplementation((pluginId: string) => {
                callOrder.push(pluginId);
                return Promise.resolve({ success: true, durationMs: 10 });
            });

            // LOAD is sequential
            await dispatcher.dispatch(HookType.LOAD, undefined);

            expect(callOrder).toEqual(['plugin-a', 'plugin-b']);
        });

        it('should use custom timeout from options', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            await dispatcher.dispatch(HookType.BLOCK_CHANGE, {}, { timeoutMs: 10000 });

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.BLOCK_CHANGE,
                {},
                10000,
            );
        });

        it('should stop sequential execution on error when continueOnError is false', async () => {
            mockGetEnabled.mockReturnValue([
                { id: 'plugin-a' } as never,
                { id: 'plugin-b' } as never,
            ]);

            mockExecuteHook.mockResolvedValueOnce({
                success: false,
                durationMs: 10,
                error: 'Failed',
            });

            const results = await dispatcher.dispatch(HookType.LOAD, undefined, {
                continueOnError: false,
            });

            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(false);
        });

        it('should continue sequential execution on error when continueOnError is true', async () => {
            mockGetEnabled.mockReturnValue([
                { id: 'plugin-a' } as never,
                { id: 'plugin-b' } as never,
            ]);

            mockExecuteHook
                .mockResolvedValueOnce({
                    success: false,
                    durationMs: 10,
                    error: 'Failed',
                })
                .mockResolvedValueOnce({
                    success: true,
                    durationMs: 10,
                });

            const results = await dispatcher.dispatch(HookType.LOAD, undefined, {
                continueOnError: true,
            });

            expect(results).toHaveLength(2);
        });

        it('should handle errors thrown by worker pool', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            mockExecuteHook.mockRejectedValue(new Error('Worker error'));

            const results = await dispatcher.dispatch(HookType.BLOCK_CHANGE, {});

            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(false);
            expect(results[0].error).toBe('Worker error');
        });

        it('should handle parallel execution with continueOnError', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
                { id: 'plugin-b' } as never,
            ]);

            mockExecuteHook
                .mockRejectedValueOnce(new Error('Plugin A failed'))
                .mockResolvedValueOnce({ success: true, durationMs: 10 });

            const results = await dispatcher.dispatch(
                HookType.BLOCK_CHANGE,
                {},
                {
                    continueOnError: true,
                },
            );

            expect(results).toHaveLength(2);
            // Both should be in results
            const failedResult = results.find((r) => !r.success);
            const successResult = results.find((r) => r.success);
            expect(failedResult).toBeDefined();
            expect(successResult).toBeDefined();
        });
    });

    describe('dispatchBlockPreProcess', () => {
        it('should dispatch BLOCK_PRE_PROCESS hook', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            const blockData = { height: 100 } as never;
            await dispatcher.dispatchBlockPreProcess(blockData);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.BLOCK_PRE_PROCESS,
                blockData,
                expect.any(Number),
            );
        });
    });

    describe('dispatchBlockPostProcess', () => {
        it('should dispatch BLOCK_POST_PROCESS hook', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            const blockData = { blockHeight: 100n } as never;
            await dispatcher.dispatchBlockPostProcess(blockData);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.BLOCK_POST_PROCESS,
                blockData,
                expect.any(Number),
            );
        });
    });

    describe('dispatchBlockChange', () => {
        it('should dispatch BLOCK_CHANGE hook', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            const blockData = { blockHeight: 100n } as never;
            await dispatcher.dispatchBlockChange(blockData);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.BLOCK_CHANGE,
                blockData,
                expect.any(Number),
            );
        });
    });

    describe('dispatchEpochChange', () => {
        it('should dispatch EPOCH_CHANGE hook', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            const epochData = { epochNumber: 1n } as never;
            await dispatcher.dispatchEpochChange(epochData);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.EPOCH_CHANGE,
                epochData,
                expect.any(Number),
            );
        });
    });

    describe('dispatchEpochFinalized', () => {
        it('should dispatch EPOCH_FINALIZED hook', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            const epochData = { epochNumber: 1n } as never;
            await dispatcher.dispatchEpochFinalized(epochData);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.EPOCH_FINALIZED,
                epochData,
                expect.any(Number),
            );
        });
    });

    describe('dispatchMempoolTransaction', () => {
        it('should dispatch MEMPOOL_TRANSACTION hook', async () => {
            mockGetWithPermission.mockReturnValue([
                { id: 'plugin-a' } as never,
            ]);

            const txData = { txid: 'abc123' } as never;
            await dispatcher.dispatchMempoolTransaction(txData);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.MEMPOOL_TRANSACTION,
                txData,
                expect.any(Number),
            );
        });
    });

    describe('dispatchReorg', () => {
        it('should dispatch REORG hook with continueOnError false', async () => {
            mockGetEnabled.mockReturnValue([{ id: 'plugin-a' } as never]);

            const reorgData = { fromBlock: 100n, toBlock: 95n } as never;
            await dispatcher.dispatchReorg(reorgData);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.REORG,
                reorgData,
                expect.any(Number),
            );
        });

        it('should log failures during reorg', async () => {
            mockGetEnabled.mockReturnValue([{ id: 'plugin-a' } as never]);
            mockExecuteHook.mockResolvedValue({
                success: false,
                durationMs: 10,
                error: 'Reorg failed',
            });

            const errorSpy = vi.spyOn(dispatcher as never, 'error');
            const reorgData = { fromBlock: 100n, toBlock: 95n } as never;
            await dispatcher.dispatchReorg(reorgData);

            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('dispatchReindexRequired', () => {
        it('should dispatch to specific plugin with result', async () => {
            const reindexCheck = {
                reindexEnabled: true,
                reindexFromBlock: 50n,
                pluginLastSyncedBlock: 100n,
                action: ReindexAction.PURGE,
                requiresPurge: true,
                purgeToBlock: 50n,
                requiresSync: true,
                syncFromBlock: 50n,
                syncToBlock: 50n,
            };

            const result = await dispatcher.dispatchReindexRequired('plugin-a', reindexCheck);

            expect(mockExecuteHookWithResult).toHaveBeenCalledWith(
                'plugin-a',
                HookType.REINDEX_REQUIRED,
                reindexCheck,
                HOOK_CONFIGS[HookType.REINDEX_REQUIRED].timeoutMs,
            );
            expect(result.success).toBe(true);
            expect(result.hookType).toBe(HookType.REINDEX_REQUIRED);
            expect(result.result).toBe(true);
        });

        it('should handle errors from worker pool', async () => {
            mockExecuteHookWithResult.mockRejectedValue(
                new Error('Reindex failed'),
            );

            const reindexCheck = {
                reindexEnabled: true,
                reindexFromBlock: 50n,
                pluginLastSyncedBlock: 100n,
                action: ReindexAction.PURGE,
                requiresPurge: true,
                purgeToBlock: 50n,
                requiresSync: true,
                syncFromBlock: 50n,
                syncToBlock: 50n,
            };

            const errorSpy = vi.spyOn(dispatcher as never, 'error');
            const result = await dispatcher.dispatchReindexRequired('plugin-a', reindexCheck);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Reindex failed');
            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('dispatchPurgeBlocks', () => {
        it('should dispatch purge to specific plugin', async () => {
            const result = await dispatcher.dispatchPurgeBlocks('plugin-a', 100n, 50n);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.PURGE_BLOCKS,
                { fromBlock: 100n, toBlock: 50n },
                HOOK_CONFIGS[HookType.PURGE_BLOCKS].timeoutMs,
            );
            expect(result.success).toBe(true);
            expect(result.hookType).toBe(HookType.PURGE_BLOCKS);
        });

        it('should handle undefined toBlock', async () => {
            await dispatcher.dispatchPurgeBlocks('plugin-a', 100n);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.PURGE_BLOCKS,
                { fromBlock: 100n, toBlock: undefined },
                expect.any(Number),
            );
        });

        it('should handle errors from worker pool', async () => {
            mockExecuteHook.mockRejectedValue(new Error('Purge failed'));

            const errorSpy = vi.spyOn(dispatcher as never, 'error');
            const result = await dispatcher.dispatchPurgeBlocks('plugin-a', 100n);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Purge failed');
            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('dispatchToPlugin', () => {
        it('should dispatch hook to specific plugin', async () => {
            const payload = { data: 'test' };
            const result = await dispatcher.dispatchToPlugin(
                'plugin-a',
                HookType.BLOCK_CHANGE,
                payload,
            );

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.BLOCK_CHANGE,
                payload,
                expect.any(Number),
            );
            expect(result.success).toBe(true);
            expect(result.pluginName).toBe('plugin-a');
        });

        it('should use custom timeout', async () => {
            await dispatcher.dispatchToPlugin('plugin-a', HookType.BLOCK_CHANGE, {}, 15000);

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                HookType.BLOCK_CHANGE,
                {},
                15000,
            );
        });

        it('should handle errors', async () => {
            mockExecuteHook.mockRejectedValue(new Error('Plugin error'));

            const result = await dispatcher.dispatchToPlugin('plugin-a', HookType.BLOCK_CHANGE, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe('Plugin error');
        });

        it('should use default timeout when config not found', async () => {
            await dispatcher.dispatchToPlugin('plugin-a', 'unknown' as HookType, {});

            expect(mockExecuteHook).toHaveBeenCalledWith(
                'plugin-a',
                'unknown',
                {},
                5000, // Default timeout
            );
        });
    });

    describe('HOOK_CONFIGS', () => {
        it('should have correct config for lifecycle hooks', () => {
            expect(HOOK_CONFIGS[HookType.LOAD].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.UNLOAD].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.ENABLE].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.DISABLE].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
        });

        it('should have correct config for block hooks', () => {
            expect(HOOK_CONFIGS[HookType.BLOCK_PRE_PROCESS].executionMode).toBe(
                HookExecutionMode.PARALLEL,
            );
            expect(HOOK_CONFIGS[HookType.BLOCK_POST_PROCESS].executionMode).toBe(
                HookExecutionMode.PARALLEL,
            );
            expect(HOOK_CONFIGS[HookType.BLOCK_CHANGE].executionMode).toBe(
                HookExecutionMode.PARALLEL,
            );
        });

        it('should have correct config for epoch hooks', () => {
            expect(HOOK_CONFIGS[HookType.EPOCH_CHANGE].executionMode).toBe(
                HookExecutionMode.PARALLEL,
            );
            expect(HOOK_CONFIGS[HookType.EPOCH_FINALIZED].executionMode).toBe(
                HookExecutionMode.PARALLEL,
            );
        });

        it('should have correct config for reorg hook (critical)', () => {
            expect(HOOK_CONFIGS[HookType.REORG].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.REORG].timeoutMs).toBe(300000);
        });

        it('should have correct config for reindex hooks (critical)', () => {
            expect(HOOK_CONFIGS[HookType.REINDEX_REQUIRED].executionMode).toBe(
                HookExecutionMode.SEQUENTIAL,
            );
            expect(HOOK_CONFIGS[HookType.REINDEX_REQUIRED].timeoutMs).toBe(600000);
            expect(HOOK_CONFIGS[HookType.PURGE_BLOCKS].timeoutMs).toBe(600000);
        });

        it('should have required permissions for block hooks', () => {
            expect(HOOK_CONFIGS[HookType.BLOCK_PRE_PROCESS].requiredPermission).toBe(
                'blocks.preProcess',
            );
            expect(HOOK_CONFIGS[HookType.BLOCK_POST_PROCESS].requiredPermission).toBe(
                'blocks.postProcess',
            );
            expect(HOOK_CONFIGS[HookType.BLOCK_CHANGE].requiredPermission).toBe('blocks.onChange');
        });

        it('should have required permissions for epoch hooks', () => {
            expect(HOOK_CONFIGS[HookType.EPOCH_CHANGE].requiredPermission).toBe('epochs.onChange');
            expect(HOOK_CONFIGS[HookType.EPOCH_FINALIZED].requiredPermission).toBe(
                'epochs.onFinalized',
            );
        });

        it('should have required permission for mempool hook', () => {
            expect(HOOK_CONFIGS[HookType.MEMPOOL_TRANSACTION].requiredPermission).toBe(
                'mempool.txFeed',
            );
        });
    });
});
