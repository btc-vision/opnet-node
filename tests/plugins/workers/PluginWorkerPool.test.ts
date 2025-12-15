import { describe, it, expect, vi } from 'vitest';
import {
    WorkerResponseType,
    WorkerMessageType,
    generateRequestId,
} from '../../../src/src/plugins/workers/WorkerMessages.js';
import { HookType, HOOK_CONFIGS, HookExecutionMode } from '../../../src/src/plugins/interfaces/IPluginHooks.js';

// Test WorkerMessages utilities and configurations
describe('WorkerMessages', () => {
    describe('generateRequestId', () => {
        it('should generate unique request IDs', () => {
            const id1 = generateRequestId();
            const id2 = generateRequestId();
            const id3 = generateRequestId();

            expect(id1).not.toBe(id2);
            expect(id2).not.toBe(id3);
            expect(id1).not.toBe(id3);
        });

        it('should generate string IDs', () => {
            const id = generateRequestId();
            expect(typeof id).toBe('string');
        });
    });

    describe('WorkerMessageType', () => {
        it('should have all required message types', () => {
            expect(WorkerMessageType.LOAD_PLUGIN).toBeDefined();
            expect(WorkerMessageType.UNLOAD_PLUGIN).toBeDefined();
            expect(WorkerMessageType.ENABLE_PLUGIN).toBeDefined();
            expect(WorkerMessageType.DISABLE_PLUGIN).toBeDefined();
            expect(WorkerMessageType.EXECUTE_HOOK).toBeDefined();
            expect(WorkerMessageType.EXECUTE_ROUTE_HANDLER).toBeDefined();
            expect(WorkerMessageType.EXECUTE_WS_HANDLER).toBeDefined();
            expect(WorkerMessageType.SHUTDOWN).toBeDefined();
        });
    });

    describe('WorkerResponseType', () => {
        it('should have all required response types', () => {
            expect(WorkerResponseType.READY).toBeDefined();
            expect(WorkerResponseType.PLUGIN_LOADED).toBeDefined();
            expect(WorkerResponseType.PLUGIN_UNLOADED).toBeDefined();
            expect(WorkerResponseType.PLUGIN_ENABLED).toBeDefined();
            expect(WorkerResponseType.PLUGIN_DISABLED).toBeDefined();
            expect(WorkerResponseType.HOOK_RESULT).toBeDefined();
            expect(WorkerResponseType.ROUTE_RESULT).toBeDefined();
            expect(WorkerResponseType.WS_RESULT).toBeDefined();
            expect(WorkerResponseType.PLUGIN_ERROR).toBeDefined();
            expect(WorkerResponseType.PLUGIN_CRASHED).toBeDefined();
        });
    });
});

describe('Hook Configurations', () => {
    describe('HOOK_CONFIGS', () => {
        it('should have config for all hook types', () => {
            const hookTypes = Object.values(HookType);
            for (const hookType of hookTypes) {
                expect(HOOK_CONFIGS[hookType]).toBeDefined();
                expect(HOOK_CONFIGS[hookType].type).toBe(hookType);
            }
        });

        it('should have valid execution modes', () => {
            for (const config of Object.values(HOOK_CONFIGS)) {
                expect([HookExecutionMode.PARALLEL, HookExecutionMode.SEQUENTIAL]).toContain(
                    config.executionMode,
                );
            }
        });

        it('should have positive timeouts', () => {
            for (const config of Object.values(HOOK_CONFIGS)) {
                expect(config.timeoutMs).toBeGreaterThan(0);
            }
        });

        it('should have sequential execution for lifecycle hooks', () => {
            expect(HOOK_CONFIGS[HookType.LOAD].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.UNLOAD].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.ENABLE].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.DISABLE].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
        });

        it('should have parallel execution for block hooks', () => {
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

        it('should have sequential execution for critical hooks', () => {
            expect(HOOK_CONFIGS[HookType.REORG].executionMode).toBe(HookExecutionMode.SEQUENTIAL);
            expect(HOOK_CONFIGS[HookType.REINDEX_REQUIRED].executionMode).toBe(
                HookExecutionMode.SEQUENTIAL,
            );
            expect(HOOK_CONFIGS[HookType.PURGE_BLOCKS].executionMode).toBe(
                HookExecutionMode.SEQUENTIAL,
            );
        });

        it('should have long timeouts for reindex hooks', () => {
            // Reindex operations can take a long time
            expect(HOOK_CONFIGS[HookType.REINDEX_REQUIRED].timeoutMs).toBeGreaterThanOrEqual(
                300000,
            );
            expect(HOOK_CONFIGS[HookType.PURGE_BLOCKS].timeoutMs).toBeGreaterThanOrEqual(300000);
            expect(HOOK_CONFIGS[HookType.REORG].timeoutMs).toBeGreaterThanOrEqual(60000);
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

        it('should not require permissions for lifecycle hooks', () => {
            expect(HOOK_CONFIGS[HookType.LOAD].requiredPermission).toBeUndefined();
            expect(HOOK_CONFIGS[HookType.UNLOAD].requiredPermission).toBeUndefined();
        });

        it('should not require permissions for reorg hooks (all plugins should handle)', () => {
            expect(HOOK_CONFIGS[HookType.REORG].requiredPermission).toBeUndefined();
        });
    });
});

describe('HookType enum', () => {
    it('should have lifecycle hooks', () => {
        expect(HookType.LOAD).toBe('onLoad');
        expect(HookType.UNLOAD).toBe('onUnload');
        expect(HookType.ENABLE).toBe('onEnable');
        expect(HookType.DISABLE).toBe('onDisable');
    });

    it('should have block hooks', () => {
        expect(HookType.BLOCK_PRE_PROCESS).toBe('onBlockPreProcess');
        expect(HookType.BLOCK_POST_PROCESS).toBe('onBlockPostProcess');
        expect(HookType.BLOCK_CHANGE).toBe('onBlockChange');
    });

    it('should have epoch hooks', () => {
        expect(HookType.EPOCH_CHANGE).toBe('onEpochChange');
        expect(HookType.EPOCH_FINALIZED).toBe('onEpochFinalized');
    });

    it('should have mempool hook', () => {
        expect(HookType.MEMPOOL_TRANSACTION).toBe('onMempoolTransaction');
    });

    it('should have reorg and reindex hooks', () => {
        expect(HookType.REORG).toBe('onReorg');
        expect(HookType.REINDEX_REQUIRED).toBe('onReindexRequired');
        expect(HookType.PURGE_BLOCKS).toBe('onPurgeBlocks');
    });
});
