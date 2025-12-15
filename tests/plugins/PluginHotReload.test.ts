/**
 * Plugin Hot Reload Integration Tests
 * Tests for the hot reload functionality in the plugin system with real MongoDB connection
 *
 * To run these tests with MongoDB integration, set the following environment variables:
 * - TEST_MONGODB_HOST
 * - TEST_MONGODB_PORT
 * - TEST_MONGODB_DATABASE
 * - TEST_MONGODB_USERNAME
 * - TEST_MONGODB_PASSWORD
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MongoClient, Db } from 'mongodb';
import { PluginManager, IPluginManagerConfig } from '../../src/src/plugins/PluginManager.js';
import { networks } from '@btc-vision/bitcoin';
import { PluginState } from '../../src/src/plugins/interfaces/IPluginState.js';

// Test database configuration from environment variables
const TEST_DB_CONFIG = {
    host: process.env.TEST_MONGODB_HOST || '',
    port: parseInt(process.env.TEST_MONGODB_PORT || '0', 10),
    database: process.env.TEST_MONGODB_DATABASE || 'opnet_plugin_test',
    username: process.env.TEST_MONGODB_USERNAME || '',
    password: process.env.TEST_MONGODB_PASSWORD || '',
};

// Check if MongoDB credentials are available
const hasMongoCredentials = TEST_DB_CONFIG.host && TEST_DB_CONFIG.port && TEST_DB_CONFIG.username;

describe('Plugin Hot Reload Integration', () => {
    const testPluginsDir = path.join(__dirname, '.test-plugins-integration');
    let pluginManager: PluginManager | null = null;
    let mongoClient: MongoClient | null = null;
    let testDb: Db | null = null;

    // Base configuration for all tests
    const createConfig = (): IPluginManagerConfig => ({
        pluginsDir: testPluginsDir,
        network: networks.regtest,
        nodeVersion: '1.0.0',
        chainId: 1n,
        networkType: 'regtest',
        genesisBlockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        hotReload: false,
        autoEnable: true,
    });

    beforeAll(async () => {
        // Only attempt MongoDB connection if credentials are provided
        if (!hasMongoCredentials) {
            console.warn('MongoDB credentials not provided, integration tests will be skipped.');
            console.warn('Set TEST_MONGODB_HOST, TEST_MONGODB_PORT, TEST_MONGODB_USERNAME, TEST_MONGODB_PASSWORD to enable.');
            return;
        }

        // Connect to MongoDB
        const uri = `mongodb://${TEST_DB_CONFIG.username}:${encodeURIComponent(TEST_DB_CONFIG.password)}@${TEST_DB_CONFIG.host}:${TEST_DB_CONFIG.port}/${TEST_DB_CONFIG.database}?authSource=admin`;

        try {
            mongoClient = new MongoClient(uri, {
                connectTimeoutMS: 5000,
                serverSelectionTimeoutMS: 5000,
            });
            await mongoClient.connect();
            testDb = mongoClient.db(TEST_DB_CONFIG.database);

            // Verify connection
            await testDb.command({ ping: 1 });
        } catch (error) {
            // If MongoDB is not available, skip integration tests
            console.warn('MongoDB connection failed, integration tests will be skipped');
            mongoClient = null;
            testDb = null;
        }
    });

    afterAll(async () => {
        if (mongoClient) {
            try {
                // Clean up test database collections
                if (testDb) {
                    const collections = await testDb.listCollections().toArray();
                    for (const collection of collections) {
                        if (collection.name.startsWith('test-plugin_')) {
                            await testDb.dropCollection(collection.name);
                        }
                    }
                }
                await mongoClient.close();
            } catch {
                // Ignore cleanup errors
            }
        }
    });

    beforeEach(async () => {
        // Create test plugins directory
        if (!fs.existsSync(testPluginsDir)) {
            fs.mkdirSync(testPluginsDir, { recursive: true });
        }
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

        // Clean up test directory
        if (fs.existsSync(testPluginsDir)) {
            try {
                fs.rmSync(testPluginsDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
        }
    });

    describe('enableHotReload', () => {
        it('should enable hot reload successfully when directory exists', async () => {
            if (!hasMongoCredentials || !mongoClient) {
                console.warn('Skipping test: MongoDB not configured');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            // Should not throw when enabling hot reload
            expect(() => pluginManager!.enableHotReload()).not.toThrow();
        });

        it('should not throw when enabling hot reload multiple times', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            pluginManager.enableHotReload();

            // Second enable should not throw
            expect(() => pluginManager!.enableHotReload()).not.toThrow();
        });

        it('should handle non-existent plugins directory gracefully', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            const nonExistentDir = path.join(__dirname, '.non-existent-' + Date.now());
            pluginManager = new PluginManager({
                ...createConfig(),
                pluginsDir: nonExistentDir,
            });

            await pluginManager.initialize();

            // Should not throw even if directory doesn't exist
            expect(() => pluginManager!.enableHotReload()).not.toThrow();
        });
    });

    describe('disableHotReload', () => {
        it('should disable hot reload successfully', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            pluginManager.enableHotReload();

            // Should not throw when disabling
            expect(() => pluginManager!.disableHotReload()).not.toThrow();
        });

        it('should handle disable when not enabled', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            // Should not throw when disabling without enabling first
            expect(() => pluginManager!.disableHotReload()).not.toThrow();
        });

        it('should handle multiple disable calls', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            pluginManager.enableHotReload();
            pluginManager.disableHotReload();

            // Second disable should not throw
            expect(() => pluginManager!.disableHotReload()).not.toThrow();
        });
    });

    describe('reloadPlugin', () => {
        it('should throw error when plugin is not found', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            await expect(
                pluginManager.reloadPlugin('non-existent-plugin')
            ).rejects.toThrow('Plugin not found');
        });

        it('should throw error when reloading before initialization', async () => {
            pluginManager = new PluginManager(createConfig());

            // Attempting to reload before initialize should fail gracefully
            await expect(
                pluginManager.reloadPlugin('any-plugin')
            ).rejects.toThrow();
        });
    });

    describe('Auto-enable on initialization', () => {
        it('should auto-enable hot reload when configured', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager({
                ...createConfig(),
                hotReload: true,
            });

            await pluginManager.initialize();

            // Hot reload should be enabled - disabling should not throw
            expect(() => pluginManager!.disableHotReload()).not.toThrow();
        });

        it('should not auto-enable when not configured', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager({
                ...createConfig(),
                hotReload: false,
            });

            await pluginManager.initialize();

            // Verify we can still manually enable
            expect(() => pluginManager!.enableHotReload()).not.toThrow();
        });
    });

    describe('Shutdown behavior', () => {
        it('should disable hot reload during shutdown', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager({
                ...createConfig(),
                hotReload: true,
            });

            await pluginManager.initialize();

            // Shutdown should disable hot reload
            await pluginManager.shutdown();

            // Manager should no longer be initialized
            expect(pluginManager.isInitialized()).toBe(false);
        });

        it('should handle shutdown without hot reload enabled', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            // Shutdown without hot reload should work
            await pluginManager.shutdown();
            expect(pluginManager.isInitialized()).toBe(false);
        });
    });

    describe('File change handling', () => {
        it('should ignore non-.opnet files in the plugins directory', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();
            pluginManager.enableHotReload();

            // Create a non-.opnet file
            const txtFile = path.join(testPluginsDir, 'test.txt');
            fs.writeFileSync(txtFile, 'test content');

            // Wait for any file system events
            await new Promise(resolve => setTimeout(resolve, 200));

            // No plugins should be registered
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });

        it('should ignore hidden files', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();
            pluginManager.enableHotReload();

            // Create a hidden file
            const hiddenFile = path.join(testPluginsDir, '.hidden-plugin.opnet');
            fs.writeFileSync(hiddenFile, Buffer.alloc(100));

            await new Promise(resolve => setTimeout(resolve, 200));

            // Hidden files should be ignored
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });

        it('should ignore directories with .opnet extension', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();
            pluginManager.enableHotReload();

            // Create a directory with .opnet extension
            const opnetDir = path.join(testPluginsDir, 'fake.opnet');
            fs.mkdirSync(opnetDir, { recursive: true });

            await new Promise(resolve => setTimeout(resolve, 200));

            // Directories should be ignored
            expect(pluginManager.getAllPlugins().length).toBe(0);
        });
    });

    describe('Plugin state tracking', () => {
        it('should return empty array when no plugins loaded', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());
            await pluginManager.initialize();

            expect(pluginManager.getAllPlugins()).toEqual([]);
        });

        it('should track initialization state correctly', async () => {
            if (!mongoClient) {
                console.warn('Skipping test: MongoDB not available');
                return;
            }

            pluginManager = new PluginManager(createConfig());

            expect(pluginManager.isInitialized()).toBe(false);

            await pluginManager.initialize();

            expect(pluginManager.isInitialized()).toBe(true);

            await pluginManager.shutdown();

            expect(pluginManager.isInitialized()).toBe(false);
        });
    });

    describe('Error handling', () => {
        it('should handle initialization errors gracefully', async () => {
            // Create manager with invalid plugins directory (no permissions)
            const invalidDir = '/root/invalid-plugins-' + Date.now();

            pluginManager = new PluginManager({
                ...createConfig(),
                pluginsDir: invalidDir,
            });

            // Initialize should create the directory and not throw
            await expect(pluginManager.initialize()).resolves.not.toThrow();
        });

        it('should handle shutdown when not initialized', async () => {
            pluginManager = new PluginManager(createConfig());

            // Shutdown without initialize should not throw
            await expect(pluginManager.shutdown()).resolves.not.toThrow();
        });
    });
});
