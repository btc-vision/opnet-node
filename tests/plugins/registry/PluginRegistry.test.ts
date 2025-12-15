import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    PluginRegistry,
    DependencyResolutionError,
} from '../../../src/src/plugins/registry/PluginRegistry.js';
import {
    PluginState,
    IPluginStateChange,
} from '../../../src/src/plugins/interfaces/IPluginState.js';
import {
    createMockMetadata,
    createMockParsedPluginFile,
} from '../mocks/index.js';

describe('PluginRegistry', () => {
    let registry: PluginRegistry;

    beforeEach(() => {
        registry = new PluginRegistry();
    });

    describe('register', () => {
        it('should register a plugin', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            const plugin = registry.register('/path/to/plugin.opnet', file);

            expect(plugin.id).toBe('test-plugin');
            expect(plugin.state).toBe(PluginState.DISCOVERED);
            expect(plugin.filePath).toBe('/path/to/plugin.opnet');
        });

        it('should throw when registering duplicate plugin', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            expect(() => {
                registry.register('/path/to/another.opnet', file);
            }).toThrow('Plugin already registered');
        });

        it('should register multiple different plugins', () => {
            const file1 = createMockParsedPluginFile({ name: 'plugin-a' });
            const file2 = createMockParsedPluginFile({ name: 'plugin-b' });

            registry.register('/path/to/a.opnet', file1);
            registry.register('/path/to/b.opnet', file2);

            expect(registry.getAll()).toHaveLength(2);
        });
    });

    describe('unregister', () => {
        it('should unregister a plugin', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            registry.unregister('test-plugin');

            expect(registry.get('test-plugin')).toBeUndefined();
        });

        it('should do nothing for non-existent plugin', () => {
            expect(() => registry.unregister('non-existent')).not.toThrow();
        });

        it('should remove from dependents of dependencies', () => {
            const dep = createMockParsedPluginFile({ name: 'dependency' });
            const dependent = createMockParsedPluginFile({
                name: 'dependent',
                dependencies: { dependency: '^1.0.0' },
            });

            registry.register('/path/dep.opnet', dep);
            registry.register('/path/dependent.opnet', dependent);

            // Build dependency graph
            registry.resolveDependencies();

            const depPlugin = registry.get('dependency');
            expect(depPlugin?.dependents.has('dependent')).toBe(true);

            // Unregister dependent
            registry.unregister('dependent');
            expect(depPlugin?.dependents.has('dependent')).toBe(false);
        });
    });

    describe('get', () => {
        it('should return plugin by ID', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            const plugin = registry.get('test-plugin');
            expect(plugin?.id).toBe('test-plugin');
        });

        it('should return undefined for non-existent plugin', () => {
            expect(registry.get('non-existent')).toBeUndefined();
        });
    });

    describe('getAll', () => {
        it('should return all plugins', () => {
            const file1 = createMockParsedPluginFile({ name: 'plugin-a' });
            const file2 = createMockParsedPluginFile({ name: 'plugin-b' });

            registry.register('/path/a.opnet', file1);
            registry.register('/path/b.opnet', file2);

            const all = registry.getAll();
            expect(all).toHaveLength(2);
            expect(all.map((p) => p.id)).toContain('plugin-a');
            expect(all.map((p) => p.id)).toContain('plugin-b');
        });

        it('should return empty array when no plugins', () => {
            expect(registry.getAll()).toEqual([]);
        });
    });

    describe('getByState', () => {
        it('should return plugins in specific state', () => {
            const file1 = createMockParsedPluginFile({ name: 'plugin-a' });
            const file2 = createMockParsedPluginFile({ name: 'plugin-b' });

            registry.register('/path/a.opnet', file1);
            registry.register('/path/b.opnet', file2);
            // Follow valid transition chain: DISCOVERED -> VALIDATED -> LOADING -> LOADED
            registry.setState('plugin-a', PluginState.VALIDATED);
            registry.setState('plugin-a', PluginState.LOADING);
            registry.setState('plugin-a', PluginState.LOADED);

            const discovered = registry.getByState(PluginState.DISCOVERED);
            const loaded = registry.getByState(PluginState.LOADED);

            expect(discovered).toHaveLength(1);
            expect(discovered[0].id).toBe('plugin-b');
            expect(loaded).toHaveLength(1);
            expect(loaded[0].id).toBe('plugin-a');
        });
    });

    describe('getEnabled', () => {
        it('should return only enabled plugins', () => {
            const file1 = createMockParsedPluginFile({ name: 'plugin-a' });
            const file2 = createMockParsedPluginFile({ name: 'plugin-b' });

            registry.register('/path/a.opnet', file1);
            registry.register('/path/b.opnet', file2);
            // Follow valid transition chain
            registry.setState('plugin-a', PluginState.VALIDATED);
            registry.setState('plugin-a', PluginState.LOADING);
            registry.setState('plugin-a', PluginState.LOADED);
            registry.setState('plugin-a', PluginState.ENABLED);

            const enabled = registry.getEnabled();
            expect(enabled).toHaveLength(1);
            expect(enabled[0].id).toBe('plugin-a');
        });
    });

    describe('getWithPermission', () => {
        it('should return plugins with specific permission', () => {
            const file1 = createMockParsedPluginFile({
                name: 'plugin-a',
                permissions: {
                    blocks: { preProcess: true, postProcess: false, onChange: false },
                },
            });
            const file2 = createMockParsedPluginFile({
                name: 'plugin-b',
                permissions: {
                    blocks: { preProcess: false, postProcess: true, onChange: false },
                },
            });

            registry.register('/path/a.opnet', file1);
            registry.register('/path/b.opnet', file2);
            // Follow valid transition chain for plugin-a
            registry.setState('plugin-a', PluginState.VALIDATED);
            registry.setState('plugin-a', PluginState.LOADING);
            registry.setState('plugin-a', PluginState.LOADED);
            registry.setState('plugin-a', PluginState.ENABLED);
            // Follow valid transition chain for plugin-b
            registry.setState('plugin-b', PluginState.VALIDATED);
            registry.setState('plugin-b', PluginState.LOADING);
            registry.setState('plugin-b', PluginState.LOADED);
            registry.setState('plugin-b', PluginState.ENABLED);

            const preProcess = registry.getWithPermission('blocks.preProcess');
            const postProcess = registry.getWithPermission('blocks.postProcess');

            expect(preProcess).toHaveLength(1);
            expect(preProcess[0].id).toBe('plugin-a');
            expect(postProcess).toHaveLength(1);
            expect(postProcess[0].id).toBe('plugin-b');
        });

        it('should only include enabled plugins', () => {
            const file = createMockParsedPluginFile({
                name: 'plugin-a',
                permissions: {
                    blocks: { preProcess: true, postProcess: false, onChange: false },
                },
            });

            registry.register('/path/a.opnet', file);

            const result = registry.getWithPermission('blocks.preProcess');
            expect(result).toHaveLength(0); // Not enabled yet
        });

        it('should handle nested permission paths', () => {
            const file = createMockParsedPluginFile({
                name: 'plugin-a',
                permissions: {
                    database: { enabled: true, collections: ['test'] },
                },
            });

            registry.register('/path/a.opnet', file);
            // Follow valid transition chain
            registry.setState('plugin-a', PluginState.VALIDATED);
            registry.setState('plugin-a', PluginState.LOADING);
            registry.setState('plugin-a', PluginState.LOADED);
            registry.setState('plugin-a', PluginState.ENABLED);

            const result = registry.getWithPermission('database.enabled');
            expect(result).toHaveLength(1);
        });
    });

    describe('setState', () => {
        it('should update plugin state', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            // Follow valid transition chain
            registry.setState('test-plugin', PluginState.VALIDATED);
            registry.setState('test-plugin', PluginState.LOADING);
            registry.setState('test-plugin', PluginState.LOADED);

            expect(registry.get('test-plugin')?.state).toBe(PluginState.LOADED);
        });

        it('should throw for non-existent plugin', () => {
            expect(() => {
                registry.setState('non-existent', PluginState.LOADED);
            }).toThrow('Plugin not found');
        });

        it('should throw for invalid state transition', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            expect(() => {
                registry.setState('test-plugin', PluginState.ENABLED);
            }).toThrow('Invalid state transition');
        });

        it('should set loadedAt timestamp when entering LOADED state', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            // Follow valid transition chain
            registry.setState('test-plugin', PluginState.VALIDATED);
            registry.setState('test-plugin', PluginState.LOADING);
            const before = Date.now();
            registry.setState('test-plugin', PluginState.LOADED);
            const after = Date.now();

            const plugin = registry.get('test-plugin');
            expect(plugin?.loadedAt).toBeGreaterThanOrEqual(before);
            expect(plugin?.loadedAt).toBeLessThanOrEqual(after);
        });

        it('should set enabledAt timestamp when entering ENABLED state', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);
            // Follow valid transition chain
            registry.setState('test-plugin', PluginState.VALIDATED);
            registry.setState('test-plugin', PluginState.LOADING);
            registry.setState('test-plugin', PluginState.LOADED);

            const before = Date.now();
            registry.setState('test-plugin', PluginState.ENABLED);
            const after = Date.now();

            const plugin = registry.get('test-plugin');
            expect(plugin?.enabledAt).toBeGreaterThanOrEqual(before);
            expect(plugin?.enabledAt).toBeLessThanOrEqual(after);
        });

        it('should store error when transitioning to ERROR state', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            const error = { code: 'TEST_ERROR', message: 'Test error', timestamp: Date.now() };
            registry.setState('test-plugin', PluginState.ERROR, error);

            expect(registry.get('test-plugin')?.error).toEqual(error);
        });
    });

    describe('state change listeners', () => {
        it('should notify listeners on state change', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            const listener = vi.fn();
            registry.onStateChange(listener);

            // First valid transition
            registry.setState('test-plugin', PluginState.VALIDATED);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    pluginId: 'test-plugin',
                    previousState: PluginState.DISCOVERED,
                    newState: PluginState.VALIDATED,
                }),
            );
        });

        it('should allow removing listeners', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            const listener = vi.fn();
            registry.onStateChange(listener);
            registry.offStateChange(listener);

            registry.setState('test-plugin', PluginState.VALIDATED);

            expect(listener).not.toHaveBeenCalled();
        });

        it('should handle listener errors gracefully', () => {
            const file = createMockParsedPluginFile({ name: 'test-plugin' });
            registry.register('/path/to/plugin.opnet', file);

            const errorListener = vi.fn(() => {
                throw new Error('Listener error');
            });
            const goodListener = vi.fn();

            registry.onStateChange(errorListener);
            registry.onStateChange(goodListener);

            expect(() => {
                registry.setState('test-plugin', PluginState.VALIDATED);
            }).not.toThrow();

            expect(goodListener).toHaveBeenCalled();
        });
    });

    describe('resolveDependencies', () => {
        it('should return plugins in dependency order', () => {
            const libA = createMockParsedPluginFile({
                name: 'lib-a',
                pluginType: 'library',
            });
            const libB = createMockParsedPluginFile({
                name: 'lib-b',
                pluginType: 'library',
                dependencies: { 'lib-a': '^1.0.0' },
            });
            const app = createMockParsedPluginFile({
                name: 'app',
                dependencies: { 'lib-b': '^1.0.0' },
            });

            registry.register('/lib-a.opnet', libA);
            registry.register('/lib-b.opnet', libB);
            registry.register('/app.opnet', app);

            const order = registry.resolveDependencies();

            const libAIndex = order.findIndex((p) => p.id === 'lib-a');
            const libBIndex = order.findIndex((p) => p.id === 'lib-b');
            const appIndex = order.findIndex((p) => p.id === 'app');

            expect(libAIndex).toBeLessThan(libBIndex);
            expect(libBIndex).toBeLessThan(appIndex);
        });

        it('should handle plugins with no dependencies', () => {
            const plugin1 = createMockParsedPluginFile({ name: 'plugin-a' });
            const plugin2 = createMockParsedPluginFile({ name: 'plugin-b' });

            registry.register('/a.opnet', plugin1);
            registry.register('/b.opnet', plugin2);

            const order = registry.resolveDependencies();
            expect(order).toHaveLength(2);
        });

        it('should throw for circular dependencies', () => {
            const pluginA = createMockParsedPluginFile({
                name: 'plugin-a',
                dependencies: { 'plugin-b': '^1.0.0' },
            });
            const pluginB = createMockParsedPluginFile({
                name: 'plugin-b',
                dependencies: { 'plugin-a': '^1.0.0' },
            });

            registry.register('/a.opnet', pluginA);
            registry.register('/b.opnet', pluginB);

            expect(() => registry.resolveDependencies()).toThrow(DependencyResolutionError);
            expect(() => registry.resolveDependencies()).toThrow('Circular dependency');
        });

        it('should throw for missing dependency', () => {
            const plugin = createMockParsedPluginFile({
                name: 'plugin-a',
                dependencies: { 'missing-dep': '^1.0.0' },
            });

            registry.register('/a.opnet', plugin);

            expect(() => registry.resolveDependencies()).toThrow(DependencyResolutionError);
            expect(() => registry.resolveDependencies()).toThrow('Missing dependency');
        });

        it('should throw for version mismatch', () => {
            const lib = createMockParsedPluginFile({
                name: 'lib',
                version: '1.0.0',
                pluginType: 'library',
            });
            const plugin = createMockParsedPluginFile({
                name: 'plugin-a',
                dependencies: { lib: '^2.0.0' },
            });

            registry.register('/lib.opnet', lib);
            registry.register('/a.opnet', plugin);

            expect(() => registry.resolveDependencies()).toThrow(DependencyResolutionError);
            expect(() => registry.resolveDependencies()).toThrow('Version mismatch');
        });

        it('should respect load priority', () => {
            const highPriority = createMockParsedPluginFile({
                name: 'high-priority',
                lifecycle: { loadPriority: 10 },
            });
            const lowPriority = createMockParsedPluginFile({
                name: 'low-priority',
                lifecycle: { loadPriority: 200 },
            });

            registry.register('/high.opnet', highPriority);
            registry.register('/low.opnet', lowPriority);

            const order = registry.resolveDependencies();

            const highIndex = order.findIndex((p) => p.id === 'high-priority');
            const lowIndex = order.findIndex((p) => p.id === 'low-priority');

            expect(highIndex).toBeLessThan(lowIndex);
        });
    });

    describe('getDependents', () => {
        it('should return plugins that depend on given plugin', () => {
            const lib = createMockParsedPluginFile({
                name: 'lib',
                pluginType: 'library',
            });
            const app1 = createMockParsedPluginFile({
                name: 'app1',
                dependencies: { lib: '^1.0.0' },
            });
            const app2 = createMockParsedPluginFile({
                name: 'app2',
                dependencies: { lib: '^1.0.0' },
            });

            registry.register('/lib.opnet', lib);
            registry.register('/app1.opnet', app1);
            registry.register('/app2.opnet', app2);

            registry.resolveDependencies();

            const dependents = registry.getDependents('lib');
            expect(dependents).toHaveLength(2);
            expect(dependents.map((p) => p.id)).toContain('app1');
            expect(dependents.map((p) => p.id)).toContain('app2');
        });

        it('should return empty array for unknown plugin', () => {
            expect(registry.getDependents('unknown')).toEqual([]);
        });
    });

    describe('getDependencies', () => {
        it('should return plugins that given plugin depends on', () => {
            const libA = createMockParsedPluginFile({
                name: 'lib-a',
                pluginType: 'library',
            });
            const libB = createMockParsedPluginFile({
                name: 'lib-b',
                pluginType: 'library',
            });
            const app = createMockParsedPluginFile({
                name: 'app',
                dependencies: { 'lib-a': '^1.0.0', 'lib-b': '^1.0.0' },
            });

            registry.register('/lib-a.opnet', libA);
            registry.register('/lib-b.opnet', libB);
            registry.register('/app.opnet', app);

            registry.resolveDependencies();

            const dependencies = registry.getDependencies('app');
            expect(dependencies).toHaveLength(2);
            expect(dependencies.map((p) => p.id)).toContain('lib-a');
            expect(dependencies.map((p) => p.id)).toContain('lib-b');
        });

        it('should return empty array for unknown plugin', () => {
            expect(registry.getDependencies('unknown')).toEqual([]);
        });
    });

    describe('getUnloadOrder', () => {
        it('should return plugins in reverse dependency order', () => {
            const lib = createMockParsedPluginFile({
                name: 'lib',
                pluginType: 'library',
            });
            const app = createMockParsedPluginFile({
                name: 'app',
                dependencies: { lib: '^1.0.0' },
            });

            registry.register('/lib.opnet', lib);
            registry.register('/app.opnet', app);

            const unloadOrder = registry.getUnloadOrder();

            const libIndex = unloadOrder.findIndex((p) => p.id === 'lib');
            const appIndex = unloadOrder.findIndex((p) => p.id === 'app');

            // App should be unloaded before lib (dependents first)
            expect(appIndex).toBeLessThan(libIndex);
        });
    });

    describe('areDependenciesReady', () => {
        it('should return true when all dependencies are enabled', () => {
            const lib = createMockParsedPluginFile({
                name: 'lib',
                pluginType: 'library',
            });
            const app = createMockParsedPluginFile({
                name: 'app',
                dependencies: { lib: '^1.0.0' },
            });

            registry.register('/lib.opnet', lib);
            registry.register('/app.opnet', app);
            registry.resolveDependencies();

            // Follow valid transition chain
            registry.setState('lib', PluginState.VALIDATED);
            registry.setState('lib', PluginState.LOADING);
            registry.setState('lib', PluginState.LOADED);
            registry.setState('lib', PluginState.ENABLED);

            expect(registry.areDependenciesReady('app')).toBe(true);
        });

        it('should return false when dependency is not enabled', () => {
            const lib = createMockParsedPluginFile({
                name: 'lib',
                pluginType: 'library',
            });
            const app = createMockParsedPluginFile({
                name: 'app',
                dependencies: { lib: '^1.0.0' },
            });

            registry.register('/lib.opnet', lib);
            registry.register('/app.opnet', app);
            registry.resolveDependencies();

            expect(registry.areDependenciesReady('app')).toBe(false);
        });

        it('should return true when no dependencies', () => {
            const app = createMockParsedPluginFile({ name: 'app' });
            registry.register('/app.opnet', app);
            registry.resolveDependencies();

            expect(registry.areDependenciesReady('app')).toBe(true);
        });

        it('should return false for unknown plugin', () => {
            expect(registry.areDependenciesReady('unknown')).toBe(false);
        });
    });

    describe('getPluginNamespace', () => {
        it('should convert plugin ID to namespace', () => {
            expect(PluginRegistry.getPluginNamespace('my-awesome-plugin')).toBe('MyAwesomePlugin');
        });

        it('should handle single word', () => {
            expect(PluginRegistry.getPluginNamespace('plugin')).toBe('Plugin');
        });

        it('should handle multiple hyphens', () => {
            expect(PluginRegistry.getPluginNamespace('a-b-c-d')).toBe('ABCD');
        });
    });

    describe('DependencyResolutionError', () => {
        it('should create error with message and plugin ID', () => {
            const error = new DependencyResolutionError('Test error', 'plugin-id');
            expect(error.message).toBe('Test error');
            expect(error.pluginId).toBe('plugin-id');
            expect(error.name).toBe('DependencyResolutionError');
        });

        it('should include dependency when provided', () => {
            const error = new DependencyResolutionError('Test error', 'plugin-id', 'dep-name');
            expect(error.dependency).toBe('dep-name');
        });
    });
});
