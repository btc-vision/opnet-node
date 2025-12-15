import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    PluginContext,
    IPluginLogger,
    IPluginConfig,
    IPluginDatabaseAPI,
    IPluginFilesystemAPI,
    EventHandler,
    SyncStateGetter,
    SyncStateSetter,
    BlockHeightGetter,
} from '../../../src/src/plugins/context/PluginContext.js';
import { IPluginMetadata } from '../../../src/src/plugins/interfaces/IPluginMetadata.js';
import {
    INetworkInfo,
    IPluginInstallState,
    PluginSyncStatus,
    ReindexAction,
} from '../../../src/src/plugins/interfaces/IPluginInstallState.js';
import { IPlugin } from '../../../src/src/plugins/interfaces/IPlugin.js';
import { createMockMetadata } from '../mocks/index.js';

describe('PluginContext', () => {
    let mockLogger: IPluginLogger;
    let mockConfig: IPluginConfig;
    let mockFs: IPluginFilesystemAPI;
    let mockDb: IPluginDatabaseAPI;
    let mockPluginGetter: (name: string) => IPlugin | undefined;
    let mockSyncStateGetter: SyncStateGetter;
    let mockSyncStateSetter: SyncStateSetter;
    let mockBlockHeightGetter: BlockHeightGetter;
    let mockNetworkInfo: INetworkInfo;
    let configStore: Record<string, unknown>;

    beforeEach(() => {
        mockLogger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        configStore = {};
        mockConfig = {
            get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => {
                return (configStore[key] as T) ?? defaultValue;
            }),
            set: vi.fn((key: string, value: unknown) => {
                configStore[key] = value;
            }),
            has: vi.fn((key: string) => key in configStore),
            getAll: vi.fn(() => configStore),
        };

        mockFs = {
            readFile: vi.fn(),
            writeFile: vi.fn(),
            exists: vi.fn(),
            mkdir: vi.fn(),
            readdir: vi.fn(),
            unlink: vi.fn(),
            stat: vi.fn(),
        };

        mockDb = {
            collection: vi.fn(),
            listCollections: vi.fn(() => []),
        };

        mockPluginGetter = vi.fn(() => undefined);
        mockSyncStateGetter = vi.fn(() => undefined);
        mockSyncStateSetter = vi.fn(async () => {});
        mockBlockHeightGetter = vi.fn(() => 100n);

        mockNetworkInfo = {
            chainId: 1n,
            network: 'regtest',
            currentBlockHeight: 100n,
            genesisBlockHash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        };
    });

    function createContext(
        metadataOverrides: Partial<IPluginMetadata> = {},
        options?: {
            db?: IPluginDatabaseAPI;
            blockchain?: unknown;
            workerFactory?: (script: string) => unknown;
            isFirstInstall?: boolean;
            enabledAtBlock?: bigint;
            emitErrorOrWarning?: boolean;
        },
    ): PluginContext {
        const metadata = createMockMetadata(metadataOverrides);
        return new PluginContext(
            metadata,
            '/data/plugins/test-plugin',
            mockNetworkInfo,
            options?.db ?? mockDb,
            options?.blockchain as never,
            mockFs,
            mockLogger,
            mockConfig,
            mockPluginGetter,
            mockSyncStateGetter,
            mockSyncStateSetter,
            mockBlockHeightGetter,
            options?.isFirstInstall ?? false,
            options?.enabledAtBlock ?? 0n,
            options?.workerFactory as never,
            { emitErrorOrWarning: options?.emitErrorOrWarning },
        );
    }

    describe('constructor', () => {
        it('should initialize with metadata values', () => {
            const context = createContext({ name: 'my-plugin', version: '2.0.0' });

            expect(context.name).toBe('my-plugin');
            expect(context.version).toBe('2.0.0');
        });

        it('should set dataDir correctly', () => {
            const context = createContext();
            expect(context.dataDir).toBe('/data/plugins/test-plugin');
        });

        it('should set network info', () => {
            const context = createContext();

            expect(context.network.chainId).toBe(1n);
            expect(context.network.network).toBe('regtest');
            expect(context.network.currentBlockHeight).toBe(100n);
        });

        it('should set isFirstInstall flag', () => {
            const contextFirstInstall = createContext({}, { isFirstInstall: true });
            const contextNotFirst = createContext({}, { isFirstInstall: false });

            expect(contextFirstInstall.isFirstInstall).toBe(true);
            expect(contextNotFirst.isFirstInstall).toBe(false);
        });

        it('should set enabledAtBlock', () => {
            const context = createContext({}, { enabledAtBlock: 50n });
            expect(context.enabledAtBlock).toBe(50n);
        });

        it('should use empty permissions if not provided', () => {
            const metadata = createMockMetadata();
            delete (metadata as { permissions?: unknown }).permissions;

            const context = new PluginContext(
                metadata,
                '/data',
                mockNetworkInfo,
                mockDb,
                undefined,
                mockFs,
                mockLogger,
                mockConfig,
                mockPluginGetter,
                mockSyncStateGetter,
                mockSyncStateSetter,
                mockBlockHeightGetter,
                false,
                0n,
            );

            expect(context.permissions).toEqual({});
        });
    });

    describe('getPlugin', () => {
        it('should return plugin from getter', () => {
            const mockPlugin = { name: 'other-plugin' } as IPlugin;
            mockPluginGetter = vi.fn((name) => (name === 'other-plugin' ? mockPlugin : undefined));

            const context = createContext();
            const result = context.getPlugin('other-plugin');

            expect(result).toBe(mockPlugin);
            expect(mockPluginGetter).toHaveBeenCalledWith('other-plugin');
        });

        it('should return undefined for non-existent plugin', () => {
            const context = createContext();
            const result = context.getPlugin('non-existent');

            expect(result).toBeUndefined();
        });
    });

    describe('event system', () => {
        it('should register event handlers with on()', () => {
            const context = createContext();
            const handler: EventHandler = vi.fn();

            context.on('test-event', handler);
            context.emit('test-event', { data: 'test' });

            expect(handler).toHaveBeenCalledWith({ data: 'test' });
        });

        it('should support multiple handlers for same event', () => {
            const context = createContext();
            const handler1: EventHandler = vi.fn();
            const handler2: EventHandler = vi.fn();

            context.on('test-event', handler1);
            context.on('test-event', handler2);
            context.emit('test-event', 'payload');

            expect(handler1).toHaveBeenCalledWith('payload');
            expect(handler2).toHaveBeenCalledWith('payload');
        });

        it('should unregister handlers with off()', () => {
            const context = createContext();
            const handler: EventHandler = vi.fn();

            context.on('test-event', handler);
            context.off('test-event', handler);
            context.emit('test-event', 'data');

            expect(handler).not.toHaveBeenCalled();
        });

        it('should handle off() for non-existent event', () => {
            const context = createContext();
            const handler: EventHandler = vi.fn();

            // Should not throw
            expect(() => context.off('non-existent', handler)).not.toThrow();
        });

        it('should not call handlers for different events', () => {
            const context = createContext();
            const handler: EventHandler = vi.fn();

            context.on('event-a', handler);
            context.emit('event-b', 'data');

            expect(handler).not.toHaveBeenCalled();
        });

        it('should catch and log handler errors when emitErrorOrWarning is true', () => {
            const context = createContext({}, { emitErrorOrWarning: true });
            const errorHandler: EventHandler = () => {
                throw new Error('Handler error');
            };

            context.on('test-event', errorHandler);
            context.emit('test-event', 'data');

            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should not log errors when emitErrorOrWarning is false', () => {
            const context = createContext({}, { emitErrorOrWarning: false });
            const errorHandler: EventHandler = () => {
                throw new Error('Handler error');
            };

            context.on('test-event', errorHandler);
            context.emit('test-event', 'data');

            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });

    describe('createWorker', () => {
        it('should create worker when factory is provided', () => {
            const mockWorker = { postMessage: vi.fn() };
            const workerFactory = vi.fn(() => mockWorker);

            const context = createContext({}, { workerFactory });
            const worker = context.createWorker('script.js');

            expect(workerFactory).toHaveBeenCalledWith('script.js');
            expect(worker).toBe(mockWorker);
        });

        it('should throw when no worker factory', () => {
            const context = createContext();

            expect(() => context.createWorker('script.js')).toThrow(
                'Threading permission not granted',
            );
        });
    });

    describe('sync state methods', () => {
        it('getCurrentBlockHeight should return from getter', () => {
            mockBlockHeightGetter = vi.fn(() => 500n);
            const context = createContext();

            expect(context.getCurrentBlockHeight()).toBe(500n);
        });

        it('getSyncState should return from getter', () => {
            const mockState: IPluginInstallState = {
                pluginId: 'test',
                installedVersion: '1.0.0',
                chainId: 1n,
                network: 'regtest',
                installedAt: Date.now(),
                enabledAtBlock: 0n,
                lastSyncedBlock: 50n,
                syncCompleted: true,
                collections: [],
                updatedAt: Date.now(),
            };
            mockSyncStateGetter = vi.fn(() => mockState);

            const context = createContext();
            expect(context.getSyncState()).toBe(mockState);
        });

        it('getLastSyncedBlock should return 0n when no state', () => {
            mockSyncStateGetter = vi.fn(() => undefined);
            const context = createContext();

            expect(context.getLastSyncedBlock()).toBe(0n);
        });

        it('getLastSyncedBlock should return value from state', () => {
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 75n,
            })) as SyncStateGetter;

            const context = createContext();
            expect(context.getLastSyncedBlock()).toBe(75n);
        });

        it('isSynced should return false when no state', () => {
            mockSyncStateGetter = vi.fn(() => undefined);
            mockBlockHeightGetter = vi.fn(() => 100n);

            const context = createContext();
            expect(context.isSynced()).toBe(false);
        });

        it('isSynced should return true when lastSyncedBlock >= currentHeight', () => {
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 100n,
            })) as SyncStateGetter;
            mockBlockHeightGetter = vi.fn(() => 100n);

            const context = createContext();
            expect(context.isSynced()).toBe(true);
        });

        it('isSynced should return false when behind', () => {
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 50n,
            })) as SyncStateGetter;
            mockBlockHeightGetter = vi.fn(() => 100n);

            const context = createContext();
            expect(context.isSynced()).toBe(false);
        });
    });

    describe('getSyncStatus', () => {
        it('should return NEVER_SYNCED when no state', () => {
            mockSyncStateGetter = vi.fn(() => undefined);
            mockBlockHeightGetter = vi.fn(() => 100n);

            const context = createContext();
            const status = context.getSyncStatus();

            expect(status.status).toBe(PluginSyncStatus.NEVER_SYNCED);
            expect(status.lastSyncedBlock).toBe(0n);
            expect(status.chainTip).toBe(100n);
            expect(status.blocksBehind).toBe(100n);
            expect(status.requiresSync).toBe(true);
        });

        it('should return SYNCED when caught up', () => {
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 100n,
                syncCompleted: true,
            })) as SyncStateGetter;
            mockBlockHeightGetter = vi.fn(() => 100n);

            const context = createContext();
            const status = context.getSyncStatus();

            expect(status.status).toBe(PluginSyncStatus.SYNCED);
            expect(status.blocksBehind).toBe(0n);
            expect(status.requiresSync).toBe(false);
        });

        it('should return BEHIND when not caught up', () => {
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 80n,
                syncCompleted: false,
            })) as SyncStateGetter;
            mockBlockHeightGetter = vi.fn(() => 100n);

            const context = createContext();
            const status = context.getSyncStatus();

            expect(status.status).toBe(PluginSyncStatus.BEHIND);
            expect(status.blocksBehind).toBe(20n);
            expect(status.requiresSync).toBe(true);
        });

        it('should handle negative blocksBehind gracefully', () => {
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 110n,
                syncCompleted: false,
            })) as SyncStateGetter;
            mockBlockHeightGetter = vi.fn(() => 100n);

            const context = createContext();
            const status = context.getSyncStatus();

            expect(status.blocksBehind).toBe(0n);
        });
    });

    describe('sync state update methods', () => {
        it('updateLastSyncedBlock should call setter with correct params', async () => {
            const context = createContext();
            await context.updateLastSyncedBlock(150n);

            expect(mockSyncStateSetter).toHaveBeenCalledWith(
                expect.objectContaining({
                    lastSyncedBlock: 150n,
                    updatedAt: expect.any(Number),
                }),
            );
        });

        it('markSyncCompleted should set syncCompleted and update lastSyncedBlock', async () => {
            mockBlockHeightGetter = vi.fn(() => 200n);
            const context = createContext();
            await context.markSyncCompleted();

            expect(mockSyncStateSetter).toHaveBeenCalledWith(
                expect.objectContaining({
                    lastSyncedBlock: 200n,
                    syncCompleted: true,
                    updatedAt: expect.any(Number),
                }),
            );
        });

        it('resetSyncStateToBlock should update state correctly', async () => {
            const context = createContext();
            await context.resetSyncStateToBlock(50n);

            expect(mockSyncStateSetter).toHaveBeenCalledWith(
                expect.objectContaining({
                    lastSyncedBlock: 50n,
                    syncCompleted: false,
                    updatedAt: expect.any(Number),
                }),
            );
        });
    });

    describe('reindex methods', () => {
        it('isReindexEnabled should return false when no reindex info', () => {
            const context = createContext();
            expect(context.isReindexEnabled()).toBe(false);
        });

        it('isReindexEnabled should return true when reindex is enabled', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 50n,
                    inProgress: false,
                },
            };
            const context = createContext();
            expect(context.isReindexEnabled()).toBe(true);
        });

        it('getReindexInfo should return reindex info', () => {
            const reindexInfo = {
                enabled: true,
                fromBlock: 50n,
                inProgress: true,
            };
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: reindexInfo,
            };
            const context = createContext();
            expect(context.getReindexInfo()).toBe(reindexInfo);
        });

        it('getReindexFromBlock should return undefined when not enabled', () => {
            const context = createContext();
            expect(context.getReindexFromBlock()).toBeUndefined();
        });

        it('getReindexFromBlock should return fromBlock when enabled', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 75n,
                    inProgress: false,
                },
            };
            const context = createContext();
            expect(context.getReindexFromBlock()).toBe(75n);
        });
    });

    describe('getReindexCheck', () => {
        it('should return undefined when reindex not enabled', () => {
            const context = createContext();
            expect(context.getReindexCheck()).toBeUndefined();
        });

        it('should return PURGE action when plugin is ahead of reindex point', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 50n,
                    inProgress: false,
                },
            };
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 100n,
            })) as SyncStateGetter;

            const context = createContext();
            const check = context.getReindexCheck();

            expect(check).toBeDefined();
            expect(check!.action).toBe(ReindexAction.PURGE);
            expect(check!.requiresPurge).toBe(true);
            expect(check!.purgeToBlock).toBe(50n);
            expect(check!.requiresSync).toBe(true);
            expect(check!.syncFromBlock).toBe(50n);
        });

        it('should return SYNC action when plugin is behind reindex point', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 100n,
                    inProgress: false,
                },
            };
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 50n,
            })) as SyncStateGetter;

            const context = createContext();
            const check = context.getReindexCheck();

            expect(check).toBeDefined();
            expect(check!.action).toBe(ReindexAction.SYNC);
            expect(check!.requiresPurge).toBe(false);
            expect(check!.requiresSync).toBe(true);
            expect(check!.syncFromBlock).toBe(50n);
            expect(check!.syncToBlock).toBe(100n);
        });

        it('should return NONE action when plugin is at reindex point', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 50n,
                    inProgress: false,
                },
            };
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 50n,
            })) as SyncStateGetter;

            const context = createContext();
            const check = context.getReindexCheck();

            expect(check).toBeDefined();
            expect(check!.action).toBe(ReindexAction.NONE);
            expect(check!.requiresPurge).toBe(false);
            expect(check!.requiresSync).toBe(false);
        });

        it('should handle no sync state (defaults to 0n)', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 50n,
                    inProgress: false,
                },
            };
            mockSyncStateGetter = vi.fn(() => undefined);

            const context = createContext();
            const check = context.getReindexCheck();

            expect(check).toBeDefined();
            expect(check!.pluginLastSyncedBlock).toBe(0n);
            expect(check!.action).toBe(ReindexAction.SYNC);
        });
    });

    describe('requiresReindexHandling', () => {
        it('should return false when no reindex enabled', () => {
            const context = createContext();
            expect(context.requiresReindexHandling()).toBe(false);
        });

        it('should return false when action is NONE', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 50n,
                    inProgress: false,
                },
            };
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 50n,
            })) as SyncStateGetter;

            const context = createContext();
            expect(context.requiresReindexHandling()).toBe(false);
        });

        it('should return true when action is PURGE', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 50n,
                    inProgress: false,
                },
            };
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 100n,
            })) as SyncStateGetter;

            const context = createContext();
            expect(context.requiresReindexHandling()).toBe(true);
        });

        it('should return true when action is SYNC', () => {
            mockNetworkInfo = {
                ...mockNetworkInfo,
                reindex: {
                    enabled: true,
                    fromBlock: 100n,
                    inProgress: false,
                },
            };
            mockSyncStateGetter = vi.fn(() => ({
                lastSyncedBlock: 50n,
            })) as SyncStateGetter;

            const context = createContext();
            expect(context.requiresReindexHandling()).toBe(true);
        });
    });

    describe('provided APIs', () => {
        it('should expose db API when provided', () => {
            const context = createContext({}, { db: mockDb });
            expect(context.db).toBe(mockDb);
        });

        it('should not have db API when not permitted', () => {
            // Test that we can create context without db API
            const metadata = createMockMetadata();
            const context = new PluginContext(
                metadata,
                '/data',
                mockNetworkInfo,
                undefined, // No db API
                undefined,
                mockFs,
                mockLogger,
                mockConfig,
                mockPluginGetter,
                mockSyncStateGetter,
                mockSyncStateSetter,
                mockBlockHeightGetter,
                false,
                0n,
            );
            expect(context.db).toBeUndefined();
        });

        it('should expose fs API', () => {
            const context = createContext();
            expect(context.fs).toBe(mockFs);
        });

        it('should expose logger', () => {
            const context = createContext();
            expect(context.logger).toBe(mockLogger);
        });

        it('should expose config', () => {
            const context = createContext();
            expect(context.config).toBe(mockConfig);
        });
    });
});
