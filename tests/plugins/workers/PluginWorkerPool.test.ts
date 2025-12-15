import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { EventEmitter } from 'events';
import { PluginWorkerPool } from '../../../src/src/plugins/workers/PluginWorkerPool.js';
import {
    WorkerResponseType,
    WorkerMessageType,
} from '../../../src/src/plugins/workers/WorkerMessages.js';
import { HookType } from '../../../src/src/plugins/interfaces/IPluginHooks.js';
import { PluginState } from '../../../src/src/plugins/interfaces/IPluginState.js';
import { createMockMetadata, createMockParsedPluginFile } from '../mocks/index.js';

// Mock Worker class
class MockWorker extends EventEmitter {
    postMessage: Mock;
    terminate: Mock;

    constructor() {
        super();
        this.postMessage = vi.fn();
        this.terminate = vi.fn(() => Promise.resolve(0));
    }

    simulateReady() {
        process.nextTick(() => {
            this.emit('message', { type: WorkerResponseType.READY });
        });
    }

    simulateResponse(requestId: string, response: Record<string, unknown>) {
        process.nextTick(() => {
            this.emit('message', { ...response, requestId });
        });
    }

    simulateError(error: Error) {
        process.nextTick(() => {
            this.emit('error', error);
        });
    }

    simulateExit(code: number) {
        process.nextTick(() => {
            this.emit('exit', code);
        });
    }
}

// Mock worker_threads module
vi.mock('worker_threads', () => ({
    Worker: vi.fn().mockImplementation(() => {
        const worker = new MockWorker();
        // Auto-ready after creation
        worker.simulateReady();
        return worker;
    }),
}));

// Mock Logger base class
vi.mock('@btc-vision/bsi-common', () => ({
    Logger: class {
        info = vi.fn();
        warn = vi.fn();
        error = vi.fn();
        debug = vi.fn();
    },
}));

import { Worker } from 'worker_threads';

describe('PluginWorkerPool', () => {
    let pool: PluginWorkerPool;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('should use default config when not provided', () => {
            pool = new PluginWorkerPool();
            expect(pool).toBeInstanceOf(PluginWorkerPool);
        });

        it('should accept custom config', () => {
            pool = new PluginWorkerPool({
                workerCount: 4,
                defaultTimeoutMs: 60000,
            });
            expect(pool).toBeInstanceOf(PluginWorkerPool);
        });
    });

    describe('initialize', () => {
        it('should create workers based on config', async () => {
            pool = new PluginWorkerPool({ workerCount: 2 });
            await pool.initialize();

            expect(Worker).toHaveBeenCalledTimes(2);
        });

        it('should wait for all workers to be ready', async () => {
            pool = new PluginWorkerPool({ workerCount: 3 });
            await pool.initialize();

            const stats = pool.getStats();
            expect(stats.workerCount).toBe(3);
        });
    });

    describe('shutdown', () => {
        it('should shutdown all workers', async () => {
            pool = new PluginWorkerPool({ workerCount: 2 });
            await pool.initialize();

            await pool.shutdown();

            const stats = pool.getStats();
            expect(stats.workerCount).toBe(0);
        });

        it('should clear plugin mappings', async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();

            await pool.shutdown();

            const stats = pool.getStats();
            expect(stats.totalPlugins).toBe(0);
        });
    });

    describe('loadPlugin', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should load plugin into worker', async () => {
            const mockPlugin = {
                id: 'test-plugin',
                metadata: createMockMetadata(),
                file: createMockParsedPluginFile(),
                filePath: '/path/to/test-plugin.opnet',
                state: PluginState.REGISTERED,
            };

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            // Set up mock to respond with success
            const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
            workerInstance.postMessage.mockImplementation((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_LOADED,
                    success: true,
                });
            });

            await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);

            expect(workerInstance.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: WorkerMessageType.LOAD_PLUGIN,
                    pluginId: 'test-plugin',
                }),
            );
        });

        it('should track plugin in stats after loading', async () => {
            const mockPlugin = {
                id: 'test-plugin',
                metadata: createMockMetadata(),
                file: createMockParsedPluginFile(),
                filePath: '/path/to/test-plugin.opnet',
                state: PluginState.REGISTERED,
            };

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
            workerInstance.postMessage.mockImplementation((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_LOADED,
                    success: true,
                });
            });

            await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);

            const stats = pool.getStats();
            expect(stats.totalPlugins).toBe(1);
        });
    });

    describe('unloadPlugin', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should handle unloading non-existent plugin gracefully', async () => {
            // Should not throw
            await expect(pool.unloadPlugin('nonexistent')).resolves.not.toThrow();
        });

        it('should unload plugin from worker', async () => {
            const mockPlugin = {
                id: 'test-plugin',
                metadata: createMockMetadata(),
                file: createMockParsedPluginFile(),
                filePath: '/path/to/test-plugin.opnet',
                state: PluginState.REGISTERED,
            };

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
            workerInstance.postMessage.mockImplementation((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_LOADED,
                    success: true,
                });
            });

            await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);

            workerInstance.postMessage.mockImplementation((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_UNLOADED,
                    success: true,
                });
            });

            await pool.unloadPlugin('test-plugin');

            const stats = pool.getStats();
            expect(stats.totalPlugins).toBe(0);
        });
    });

    describe('enablePlugin', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should throw for non-loaded plugin', async () => {
            await expect(pool.enablePlugin('nonexistent')).rejects.toThrow(
                'Plugin nonexistent is not loaded',
            );
        });
    });

    describe('disablePlugin', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should throw for non-loaded plugin', async () => {
            await expect(pool.disablePlugin('nonexistent')).rejects.toThrow(
                'Plugin nonexistent is not loaded',
            );
        });
    });

    describe('executeHook', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should throw for non-loaded plugin', async () => {
            await expect(
                pool.executeHook('nonexistent', HookType.BLOCK_CHANGE, {}),
            ).rejects.toThrow('Plugin nonexistent is not loaded');
        });

        it('should execute hook on loaded plugin', async () => {
            const mockPlugin = {
                id: 'test-plugin',
                metadata: createMockMetadata(),
                file: createMockParsedPluginFile(),
                filePath: '/path/to/test-plugin.opnet',
                state: PluginState.REGISTERED,
            };

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;

            // First, load the plugin
            workerInstance.postMessage.mockImplementationOnce((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_LOADED,
                    success: true,
                });
            });

            await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);

            // Then execute hook
            workerInstance.postMessage.mockImplementationOnce((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.HOOK_RESULT,
                    success: true,
                    durationMs: 5,
                });
            });

            const result = await pool.executeHook('test-plugin', HookType.BLOCK_CHANGE, {});

            expect(result.success).toBe(true);
            expect(workerInstance.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: WorkerMessageType.EXECUTE_HOOK,
                    hookType: HookType.BLOCK_CHANGE,
                }),
            );
        });
    });

    describe('executeRouteHandler', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should throw for non-loaded plugin', async () => {
            await expect(
                pool.executeRouteHandler('nonexistent', 'handler', {}),
            ).rejects.toThrow('Plugin nonexistent is not loaded');
        });
    });

    describe('executeWsHandler', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should throw for non-loaded plugin', async () => {
            await expect(
                pool.executeWsHandler('nonexistent', 'handler', {}, 'req-1', 'client-1'),
            ).rejects.toThrow('Plugin nonexistent is not loaded');
        });
    });

    describe('getStats', () => {
        it('should return correct statistics', async () => {
            pool = new PluginWorkerPool({ workerCount: 2 });
            await pool.initialize();

            const stats = pool.getStats();

            expect(stats.workerCount).toBe(2);
            expect(stats.totalPlugins).toBe(0);
            expect(Object.keys(stats.pluginsPerWorker)).toHaveLength(2);
        });
    });

    describe('getPluginSyncState', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should throw for non-loaded plugin', async () => {
            await expect(pool.getPluginSyncState('nonexistent')).rejects.toThrow(
                'Plugin nonexistent is not loaded',
            );
        });
    });

    describe('resetPluginSyncState', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should throw for non-loaded plugin', async () => {
            await expect(pool.resetPluginSyncState('nonexistent', 100n)).rejects.toThrow(
                'Plugin nonexistent is not loaded',
            );
        });
    });

    describe('callbacks', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({ workerCount: 1 });
            await pool.initialize();
        });

        it('should call onPluginCrash callback when plugin crashes', async () => {
            const crashCallback = vi.fn();
            pool.onPluginCrash = crashCallback;

            const mockPlugin = {
                id: 'test-plugin',
                metadata: createMockMetadata(),
                file: createMockParsedPluginFile(),
                filePath: '/path/to/test-plugin.opnet',
                state: PluginState.REGISTERED,
            };

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
            workerInstance.postMessage.mockImplementation((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_LOADED,
                    success: true,
                });
            });

            await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);

            // Simulate plugin crash notification
            workerInstance.emit('message', {
                type: WorkerResponseType.PLUGIN_CRASHED,
                requestId: 'crash-1',
                pluginId: 'test-plugin',
                errorMessage: 'Plugin failed',
            });

            expect(crashCallback).toHaveBeenCalledWith('test-plugin', 'Plugin failed');
        });

        it('should call onSyncStateUpdate callback when sync state changes', async () => {
            const syncCallback = vi.fn();
            pool.onSyncStateUpdate = syncCallback;

            const mockPlugin = {
                id: 'test-plugin',
                metadata: createMockMetadata(),
                file: createMockParsedPluginFile(),
                filePath: '/path/to/test-plugin.opnet',
                state: PluginState.REGISTERED,
            };

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;
            workerInstance.postMessage.mockImplementation((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_LOADED,
                    success: true,
                });
            });

            await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);

            // Simulate sync state update
            workerInstance.emit('message', {
                type: WorkerResponseType.SYNC_STATE_UPDATE,
                requestId: 'sync-1',
                pluginId: 'test-plugin',
                lastSyncedBlock: '150',
                syncCompleted: true,
            });

            expect(syncCallback).toHaveBeenCalledWith('test-plugin', 150n, true);
        });
    });

    describe('worker selection', () => {
        it('should distribute plugins across workers', async () => {
            pool = new PluginWorkerPool({ workerCount: 2 });
            await pool.initialize();

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            // Set up workers to respond
            const workerInstances = vi.mocked(Worker).mock.results.map(r => r.value as MockWorker);
            workerInstances.forEach(worker => {
                worker.postMessage.mockImplementation((msg: { requestId: string }) => {
                    worker.simulateResponse(msg.requestId, {
                        type: WorkerResponseType.PLUGIN_LOADED,
                        success: true,
                    });
                });
            });

            // Load multiple plugins
            for (let i = 0; i < 4; i++) {
                const mockPlugin = {
                    id: `plugin-${i}`,
                    metadata: createMockMetadata({ name: `plugin-${i}` }),
                    file: createMockParsedPluginFile(),
                    filePath: `/path/to/plugin-${i}.opnet`,
                    state: PluginState.REGISTERED,
                };
                await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);
            }

            const stats = pool.getStats();
            expect(stats.totalPlugins).toBe(4);
            // Should be distributed across workers
            expect(Object.values(stats.pluginsPerWorker).some(count => count > 0)).toBe(true);
        });
    });

    describe('timeout handling', () => {
        beforeEach(async () => {
            pool = new PluginWorkerPool({
                workerCount: 1,
                defaultTimeoutMs: 100, // Short timeout for testing
            });
            await pool.initialize();
        });

        it('should timeout requests that take too long', async () => {
            const mockPlugin = {
                id: 'test-plugin',
                metadata: createMockMetadata(),
                file: createMockParsedPluginFile(),
                filePath: '/path/to/test-plugin.opnet',
                state: PluginState.REGISTERED,
            };

            const mockNetworkInfo = {
                chainId: 1n,
                network: 'regtest' as const,
                currentBlockHeight: 100n,
                genesisBlockHash: 'abc123',
            };

            const workerInstance = vi.mocked(Worker).mock.results[0]?.value as MockWorker;

            // First load succeeds
            workerInstance.postMessage.mockImplementationOnce((msg: { requestId: string }) => {
                workerInstance.simulateResponse(msg.requestId, {
                    type: WorkerResponseType.PLUGIN_LOADED,
                    success: true,
                });
            });

            await pool.loadPlugin(mockPlugin, {}, mockNetworkInfo);

            // Hook execution never responds (simulating timeout)
            workerInstance.postMessage.mockImplementationOnce(() => {
                // Don't respond - let it timeout
            });

            await expect(
                pool.executeHook('test-plugin', HookType.BLOCK_CHANGE, {}, 50),
            ).rejects.toThrow('timed out');
        });
    });
});
