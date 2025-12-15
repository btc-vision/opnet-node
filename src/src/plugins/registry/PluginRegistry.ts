import { Logger } from '@btc-vision/bsi-common';
import * as semver from 'semver';

import {
    IPluginError,
    IPluginStateChange,
    IRegisteredPlugin,
    isValidStateTransition,
    PluginState,
} from '../interfaces/IPluginState.js';
import { IParsedPluginFile } from '../interfaces/IPluginFile.js';

/**
 * Dependency resolution error
 */
export class DependencyResolutionError extends Error {
    constructor(
        message: string,
        public readonly pluginId: string,
        public readonly dependency?: string,
    ) {
        super(message);
        this.name = 'DependencyResolutionError';
    }
}

/**
 * Plugin Registry
 */
export class PluginRegistry extends Logger {
    public readonly logColor: string = '#9C27B0';

    /** All registered plugins */
    private readonly plugins: Map<string, IRegisteredPlugin> = new Map();

    /** State change listeners */
    private readonly stateListeners: Set<(change: IPluginStateChange) => void> = new Set();

    /**
     * Get the namespace for a plugin (used for WebSocket proto)
     */
    public static getPluginNamespace(pluginId: string): string {
        // Convert plugin-name to PluginName
        return pluginId
            .split('-')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
    }

    /**
     * Register a plugin
     */
    public register(filePath: string, file: IParsedPluginFile): IRegisteredPlugin {
        const metadata = file.metadata;
        const id = metadata.name;

        if (this.plugins.has(id)) {
            throw new Error(`Plugin already registered: ${id}`);
        }

        const plugin: IRegisteredPlugin = {
            id,
            filePath,
            file,
            metadata,
            state: PluginState.DISCOVERED,
            dependents: new Set(),
            dependencies: new Set(),
        };

        this.plugins.set(id, plugin);
        this.info(`Registered plugin: ${id} v${metadata.version}`);

        return plugin;
    }

    /**
     * Unregister a plugin
     */
    public unregister(id: string): void {
        const plugin = this.plugins.get(id);
        if (!plugin) {
            return;
        }

        // Remove from dependents of dependencies
        for (const depId of plugin.dependencies) {
            const dep = this.plugins.get(depId);
            if (dep) {
                dep.dependents.delete(id);
            }
        }

        this.plugins.delete(id);
        this.info(`Unregistered plugin: ${id}`);
    }

    /**
     * Get a plugin by ID
     */
    public get(id: string): IRegisteredPlugin | undefined {
        return this.plugins.get(id);
    }

    /**
     * Get all plugins
     */
    public getAll(): IRegisteredPlugin[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Get plugins by state
     */
    public getByState(state: PluginState): IRegisteredPlugin[] {
        return this.getAll().filter((p) => p.state === state);
    }

    /**
     * Get enabled plugins
     */
    public getEnabled(): IRegisteredPlugin[] {
        return this.getByState(PluginState.ENABLED);
    }

    /**
     * Get plugins with a specific permission
     */
    public getWithPermission(permission: string): IRegisteredPlugin[] {
        return this.getEnabled().filter((p) => {
            const parts = permission.split('.');
            let current: unknown = p.metadata.permissions;

            for (const part of parts) {
                if (current === null || current === undefined) {
                    return false;
                }
                current = (current as Record<string, unknown>)[part];
            }

            return current === true;
        });
    }

    /**
     * Update plugin state
     */
    public setState(id: string, newState: PluginState, error?: IPluginError): void {
        const plugin = this.plugins.get(id);
        if (!plugin) {
            throw new Error(`Plugin not found: ${id}`);
        }

        const previousState = plugin.state;

        if (!isValidStateTransition(previousState, newState)) {
            throw new Error(`Invalid state transition for ${id}: ${previousState} -> ${newState}`);
        }

        plugin.state = newState;
        plugin.error = error;

        if (newState === PluginState.LOADED) {
            plugin.loadedAt = Date.now();
        } else if (newState === PluginState.ENABLED) {
            plugin.enabledAt = Date.now();
        }

        this.info(`Plugin ${id} state: ${previousState} -> ${newState}`);

        // Notify listeners
        const change: IPluginStateChange = {
            pluginId: id,
            previousState,
            newState,
            timestamp: Date.now(),
            error,
        };

        for (const listener of this.stateListeners) {
            try {
                listener(change);
            } catch (e) {
                this.error(`State listener error: ${e}`);
            }
        }
    }

    /**
     * Add state change listener
     */
    public onStateChange(listener: (change: IPluginStateChange) => void): void {
        this.stateListeners.add(listener);
    }

    /**
     * Remove state change listener
     */
    public offStateChange(listener: (change: IPluginStateChange) => void): void {
        this.stateListeners.delete(listener);
    }

    /**
     * Resolve dependencies and return load order
     * Uses topological sort to determine correct load order
     */
    public resolveDependencies(): IRegisteredPlugin[] {
        // Build dependency graph
        this.buildDependencyGraph();

        // Detect cycles
        this.detectCycles();

        // Validate dependencies
        this.validateDependencies();

        // Topological sort
        return this.topologicalSort();
    }

    /**
     * Get plugins that depend on a given plugin
     */
    public getDependents(id: string): IRegisteredPlugin[] {
        const plugin = this.plugins.get(id);
        if (!plugin) {
            return [];
        }

        return Array.from(plugin.dependents)
            .map((depId) => this.plugins.get(depId))
            .filter((p): p is IRegisteredPlugin => p !== undefined);
    }

    /**
     * Get plugins that a given plugin depends on
     */
    public getDependencies(id: string): IRegisteredPlugin[] {
        const plugin = this.plugins.get(id);
        if (!plugin) {
            return [];
        }

        return Array.from(plugin.dependencies)
            .map((depId) => this.plugins.get(depId))
            .filter((p): p is IRegisteredPlugin => p !== undefined);
    }

    /**
     * Get the reverse unload order (dependents before dependencies)
     */
    public getUnloadOrder(): IRegisteredPlugin[] {
        return this.resolveDependencies().reverse();
    }

    /**
     * Check if all dependencies of a plugin are loaded and enabled
     */
    public areDependenciesReady(id: string): boolean {
        const plugin = this.plugins.get(id);
        if (!plugin) return false;

        for (const depId of plugin.dependencies) {
            const dep = this.plugins.get(depId);
            if (!dep || dep.state !== PluginState.ENABLED) {
                return false;
            }
        }

        return true;
    }

    /**
     * Build the dependency graph
     */
    private buildDependencyGraph(): void {
        for (const plugin of this.plugins.values()) {
            plugin.dependencies.clear();
            plugin.dependents.clear();
        }

        for (const plugin of this.plugins.values()) {
            const deps = plugin.metadata.dependencies ?? {};

            for (const depName of Object.keys(deps)) {
                const dep = this.plugins.get(depName);
                if (dep) {
                    plugin.dependencies.add(depName);
                    dep.dependents.add(plugin.id);
                }
            }
        }
    }

    /**
     * Detect dependency cycles
     */
    private detectCycles(): void {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const path: string[] = [];

        const dfs = (id: string): void => {
            visited.add(id);
            recursionStack.add(id);
            path.push(id);

            const plugin = this.plugins.get(id);
            if (plugin) {
                for (const depId of plugin.dependencies) {
                    if (!visited.has(depId)) {
                        dfs(depId);
                    } else if (recursionStack.has(depId)) {
                        const cycleStart = path.indexOf(depId);
                        const cycle = path.slice(cycleStart).concat(depId);
                        throw new DependencyResolutionError(
                            `Circular dependency detected: ${cycle.join(' -> ')}`,
                            id,
                        );
                    }
                }
            }

            path.pop();
            recursionStack.delete(id);
        };

        for (const id of this.plugins.keys()) {
            if (!visited.has(id)) {
                dfs(id);
            }
        }
    }

    /**
     * Validate all dependencies exist and versions are compatible
     */
    private validateDependencies(): void {
        for (const plugin of this.plugins.values()) {
            const deps = plugin.metadata.dependencies ?? {};

            for (const [depName, versionRange] of Object.entries(deps)) {
                const dep = this.plugins.get(depName);

                if (!dep) {
                    throw new DependencyResolutionError(
                        `Missing dependency: ${depName}`,
                        plugin.id,
                        depName,
                    );
                }

                if (!semver.satisfies(dep.metadata.version, versionRange)) {
                    throw new DependencyResolutionError(
                        `Version mismatch for ${depName}: requires ${versionRange}, found ${dep.metadata.version}`,
                        plugin.id,
                        depName,
                    );
                }

                // Library dependencies must be of type 'library'
                if (dep.metadata.pluginType !== 'library') {
                    this.warn(
                        `Plugin ${plugin.id} depends on ${depName} which is not a library plugin`,
                    );
                }
            }

            // Check optional dependencies
            const optDeps = plugin.metadata.optionalDependencies ?? {};
            for (const [depName, versionRange] of Object.entries(optDeps)) {
                const dep = this.plugins.get(depName);
                if (dep && !semver.satisfies(dep.metadata.version, versionRange)) {
                    this.warn(
                        `Optional dependency ${depName} version mismatch: requires ${versionRange}, found ${dep.metadata.version}`,
                    );
                }
            }
        }
    }

    /**
     * Topological sort - returns plugins in dependency order
     * (dependencies before dependents)
     */
    private topologicalSort(): IRegisteredPlugin[] {
        const result: IRegisteredPlugin[] = [];
        const visited = new Set<string>();
        const temp = new Set<string>();

        const visit = (id: string): void => {
            if (visited.has(id)) return;
            if (temp.has(id)) return; // Already being visited (cycle already checked)

            temp.add(id);

            const plugin = this.plugins.get(id);
            if (plugin) {
                // Visit dependencies first
                for (const depId of plugin.dependencies) {
                    visit(depId);
                }

                visited.add(id);
                result.push(plugin);
            }

            temp.delete(id);
        };

        // Sort by load priority first, then process
        const sortedIds = Array.from(this.plugins.keys()).sort((a, b) => {
            const pluginA = this.plugins.get(a);
            const pluginB = this.plugins.get(b);
            if (!pluginA || !pluginB) return 0;
            const priorityA = pluginA.metadata.lifecycle?.loadPriority ?? 100;
            const priorityB = pluginB.metadata.lifecycle?.loadPriority ?? 100;
            return priorityA - priorityB;
        });

        for (const id of sortedIds) {
            visit(id);
        }

        return result;
    }
}
