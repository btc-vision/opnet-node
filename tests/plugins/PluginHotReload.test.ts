/**
 * Plugin Hot Reload Tests
 * Tests for the hot reload functionality in the plugin system
 * Uses mocks so no MongoDB connection is required
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { networks } from '@btc-vision/bitcoin';
import { createMockMetadata, createPluginFileBuffer } from './mocks/index.js';
import { IPluginManagerConfig, PluginManager } from '../../src/src/plugins/PluginManager.js';

// Mock worker_threads module
vi.mock('worker_threads', async (importOriginal) => {
    const original = await importOriginal<typeof import('worker_threads')>();
    const { EventEmitter } = await import('events');

    class MockWorker extends EventEmitter {
        public threadId = Math.floor(Math.random() * 10000);

        constructor(_filename: string | URL, _options?: unknown) {
            super();
            // Emit ready event after a short delay
            setTimeout(() => {
                this.emit('message', { type: 'ready' });
            }, 10);
        }

        postMessage(message: { type: string; requestId?: string }): void {
            // Simulate successful responses for plugin operations
            setTimeout(() => {
                if (message.type === 'loadPlugin' || message.type === 'load_plugin') {
                    this.emit('message', {
                        type: 'plugin_loaded',
                        requestId: message.requestId,
                        success: true,
                    });
                } else if (message.type === 'unloadPlugin' || message.type === 'unload_plugin') {
                    this.emit('message', {
                        type: 'plugin_unloaded',
                        requestId: message.requestId,
                        success: true,
                    });
                } else if (message.type === 'enablePlugin' || message.type === 'enable_plugin') {
                    this.emit('message', {
                        type: 'plugin_enabled',
                        requestId: message.requestId,
                        success: true,
                    });
                } else if (message.type === 'disablePlugin' || message.type === 'disable_plugin') {
                    this.emit('message', {
                        type: 'plugin_disabled',
                        requestId: message.requestId,
                        success: true,
                    });
                } else if (message.type === 'shutdown') {
                    // Emit exit event for shutdown
                    this.emit('exit', 0);
                }
            }, 5);
        }

        terminate(): Promise<number> {
            // Emit exit event to properly shutdown
            setTimeout(() => {
                this.emit('exit', 0);
            }, 1);
            return Promise.resolve(0);
        }
    }

    return {
        ...original,
        Worker: MockWorker,
    };
});

// Mock the Logger class
vi.mock('@btc-vision/bsi-common', () => ({
    Logger: class {
        info = vi.fn();
        warn = vi.fn();
        error = vi.fn();
        debug = vi.fn();
        success = vi.fn();
        readonly logColor: string = '#000000';
    },
}));

describe('Plugin Hot Reload', () => {
    let tempDir: string;
    let pluginManager: PluginManager | null = null;

    const createConfig = (pluginsDir: string): IPluginManagerConfig => ({
        pluginsDir,
        network: networks.regtest,
        nodeVersion: '1.0.0',
        chainId: 1n,
        networkType: 'regtest',
        genesisBlockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        hotReload: false,
        autoEnable: false, // Disable auto-enable to control test flow
        workerPool: {
            workerCount: 1, // Use 1 worker for faster tests
            defaultTimeoutMs: 5000,
        },
    });

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-hotreload-test-'));
    });

    afterEach(async () => {
        // Shutdown plugin manager
        if (pluginManager?.isInitialized()) {
            try {
                await pluginManager.shutdown();
            } catch {
                // Ignore shutdown errors
            }
        }
        pluginManager = null;

        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
        }
    });

    describe('enableHotReload', () => {
        it('should enable hot reload successfully when directory exists', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            expect(() => pluginManager!.enableHotReload()).not.toThrow();
            expect(pluginManager.isHotReloadEnabled()).toBe(true);
        });

        it('should not throw when enabling hot reload multiple times', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            pluginManager.enableHotReload();
            expect(pluginManager.isHotReloadEnabled()).toBe(true);

            // Second enable should not throw
            expect(() => pluginManager!.enableHotReload()).not.toThrow();
            expect(pluginManager.isHotReloadEnabled()).toBe(true);
        });

        it('should handle non-existent plugins directory gracefully', async () => {
            const nonExistentDir = path.join(tempDir, 'non-existent-' + Date.now());
            pluginManager = new PluginManager(createConfig(nonExistentDir));

            await pluginManager.initialize();

            // Directory should be created during initialize
            expect(fs.existsSync(nonExistentDir)).toBe(true);

            // Should not throw
            expect(() => pluginManager!.enableHotReload()).not.toThrow();
        });
    });

    describe('disableHotReload', () => {
        it('should disable hot reload successfully', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            pluginManager.enableHotReload();
            expect(pluginManager.isHotReloadEnabled()).toBe(true);

            pluginManager.disableHotReload();
            expect(pluginManager.isHotReloadEnabled()).toBe(false);
        });

        it('should handle disable when not enabled', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            expect(pluginManager.isHotReloadEnabled()).toBe(false);

            // Should not throw when disabling without enabling first
            expect(() => pluginManager!.disableHotReload()).not.toThrow();
            expect(pluginManager.isHotReloadEnabled()).toBe(false);
        });

        it('should handle multiple disable calls', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            pluginManager.enableHotReload();
            pluginManager.disableHotReload();

            // Second disable should not throw
            expect(() => pluginManager!.disableHotReload()).not.toThrow();
            expect(pluginManager.isHotReloadEnabled()).toBe(false);
        });
    });

    describe('reloadPlugin', () => {
        it('should throw error when plugin is not found', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            await expect(pluginManager.reloadPlugin('non-existent-plugin')).rejects.toThrow(
                'Plugin not found',
            );
        });

        it('should throw error when reloading before initialization', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));

            // Attempting to reload before initialize should fail
            await expect(pluginManager.reloadPlugin('any-plugin')).rejects.toThrow();
        });
    });

    describe('Auto-enable on initialization', () => {
        it('should auto-enable hot reload when configured', async () => {
            pluginManager = new PluginManager({
                ...createConfig(tempDir),
                hotReload: true,
            });

            await pluginManager.initialize();

            expect(pluginManager.isHotReloadEnabled()).toBe(true);
        });

        it('should not auto-enable when not configured', async () => {
            pluginManager = new PluginManager({
                ...createConfig(tempDir),
                hotReload: false,
            });

            await pluginManager.initialize();

            expect(pluginManager.isHotReloadEnabled()).toBe(false);

            // Verify we can still manually enable
            expect(() => pluginManager!.enableHotReload()).not.toThrow();
            expect(pluginManager.isHotReloadEnabled()).toBe(true);
        });
    });

    describe('Shutdown behavior', () => {
        it('should disable hot reload during shutdown', async () => {
            pluginManager = new PluginManager({
                ...createConfig(tempDir),
                hotReload: true,
            });

            await pluginManager.initialize();
            expect(pluginManager.isHotReloadEnabled()).toBe(true);

            // Shutdown should disable hot reload
            await pluginManager.shutdown();

            expect(pluginManager.isInitialized()).toBe(false);
        });

        it('should handle shutdown without hot reload enabled', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            expect(pluginManager.isHotReloadEnabled()).toBe(false);

            // Shutdown without hot reload should work
            await pluginManager.shutdown();
            expect(pluginManager.isInitialized()).toBe(false);
        });

        it('should handle shutdown when not initialized', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));

            // Shutdown without initialize should not throw
            await expect(pluginManager.shutdown()).resolves.not.toThrow();
        });
    });

    describe('File change handling', () => {
        it('should ignore non-.opnet files in the plugins directory', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();
            pluginManager.enableHotReload();

            // Create a non-.opnet file
            const txtFile = path.join(tempDir, 'test.txt');
            fs.writeFileSync(txtFile, 'test content');

            // Wait for any file system events
            await new Promise((resolve) => setTimeout(resolve, 200));

            // No plugins should be registered
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });

        it('should ignore hidden files', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();
            pluginManager.enableHotReload();

            // Create a hidden file with .opnet extension (won't be picked up)
            const hiddenFile = path.join(tempDir, '.hidden-plugin.opnet');
            fs.writeFileSync(hiddenFile, Buffer.alloc(100));

            await new Promise((resolve) => setTimeout(resolve, 200));

            // Hidden files should be ignored (loader doesn't pick them up)
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });

        it('should ignore directories with .opnet extension', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();
            pluginManager.enableHotReload();

            // Create a directory with .opnet extension
            const opnetDir = path.join(tempDir, 'fake.opnet');
            fs.mkdirSync(opnetDir, { recursive: true });

            await new Promise((resolve) => setTimeout(resolve, 200));

            // Directories should be ignored
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });
    });

    describe('Plugin state tracking', () => {
        it('should return empty array when no plugins loaded', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            expect(pluginManager.getAllPlugins()).toEqual([]);
        });

        it('should track initialization state correctly', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));

            expect(pluginManager.isInitialized()).toBe(false);

            await pluginManager.initialize();

            expect(pluginManager.isInitialized()).toBe(true);

            await pluginManager.shutdown();

            expect(pluginManager.isInitialized()).toBe(false);
        });
    });

    describe('Error handling', () => {
        it('should handle initialization errors gracefully', async () => {
            // Create manager - it should create the directory
            pluginManager = new PluginManager(createConfig(tempDir));

            // Initialize should not throw
            await expect(pluginManager.initialize()).resolves.not.toThrow();
        });

        it('should throw when initializing twice', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));

            await pluginManager.initialize();

            // Second initialize should throw
            await expect(pluginManager.initialize()).rejects.toThrow('already initialized');
        });
    });

    describe('Plugin discovery', () => {
        it('should discover and register valid plugin files', async () => {
            // Create a valid plugin file
            const metadata = createMockMetadata({ name: 'test-plugin' });
            const pluginBuffer = createPluginFileBuffer(metadata);
            const pluginPath = path.join(tempDir, 'test-plugin.opnet');
            fs.writeFileSync(pluginPath, pluginBuffer);

            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            const plugins = pluginManager.getAllPlugins();
            expect(plugins.length).toBe(1);
            expect(plugins[0].id).toBe('test-plugin');
        });

        it('should skip invalid plugin files during discovery', async () => {
            // Create an invalid plugin file (too small)
            const invalidPath = path.join(tempDir, 'invalid.opnet');
            fs.writeFileSync(invalidPath, Buffer.alloc(10));

            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            // Invalid plugin should not be registered
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });

        it('should skip disabled plugin files (.opnet.disabled)', async () => {
            // Create a valid plugin file
            const metadata = createMockMetadata({ name: 'disabled-plugin' });
            const pluginBuffer = createPluginFileBuffer(metadata);

            // Save as disabled
            const pluginPath = path.join(tempDir, 'disabled-plugin.opnet.disabled');
            fs.writeFileSync(pluginPath, pluginBuffer);

            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            // Disabled plugin should not be loaded
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });
    });

    describe('Network info', () => {
        it('should return correct network info', async () => {
            pluginManager = new PluginManager({
                ...createConfig(tempDir),
                chainId: 123n,
                networkType: 'testnet',
                genesisBlockHash: 'abc123',
            });
            await pluginManager.initialize();

            const networkInfo = pluginManager.getNetworkInfo();

            expect(networkInfo.chainId).toBe(123n);
            expect(networkInfo.network).toBe('testnet');
            expect(networkInfo.genesisBlockHash).toBe('abc123');
        });

        it('should track current block height', async () => {
            pluginManager = new PluginManager(createConfig(tempDir));
            await pluginManager.initialize();

            expect(pluginManager.getCurrentBlockHeight()).toBe(0n);

            pluginManager.setCurrentBlockHeight(100n);
            expect(pluginManager.getCurrentBlockHeight()).toBe(100n);

            const networkInfo = pluginManager.getNetworkInfo();
            expect(networkInfo.currentBlockHeight).toBe(100n);
        });

        it('should include reindex info when configured', async () => {
            pluginManager = new PluginManager({
                ...createConfig(tempDir),
                reindexEnabled: true,
                reindexFromBlock: 50n,
            });
            await pluginManager.initialize();

            const networkInfo = pluginManager.getNetworkInfo();

            expect(networkInfo.reindex).toBeDefined();
            expect(networkInfo.reindex!.enabled).toBe(true);
            expect(networkInfo.reindex!.fromBlock).toBe(50n);
        });
    });
});
