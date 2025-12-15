import { Logger } from '@btc-vision/bsi-common';
import { Network } from '@btc-vision/bitcoin';
import * as fs from 'fs';
import * as path from 'path';
import type { FSWatcher } from 'fs';

import { PluginLoader, PluginLoadError } from './loader/PluginLoader.js';
import { PluginValidator, PluginValidationError } from './validator/PluginValidator.js';
import { PluginRegistry, DependencyResolutionError } from './registry/PluginRegistry.js';
import { PluginWorkerPool, IWorkerPoolConfig } from './workers/PluginWorkerPool.js';
import { HookDispatcher } from './hooks/HookDispatcher.js';
import { PluginOpcodeRegistry } from './api/websocket/PluginOpcodeRegistry.js';
import { PluginRouteRegistry } from './api/http/PluginRouteRegistry.js';
import {
    IRegisteredPlugin,
    PluginState,
    IPluginError,
} from './interfaces/IPluginState.js';
import { IParsedPluginFile } from './interfaces/IPluginFile.js';
import { IEpochData, IMempoolTransaction, IReorgData } from './interfaces/IPlugin.js';
import { BlockDataWithTransactionData } from '@btc-vision/bitcoin-rpc';
import { BlockProcessedData } from '../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { IHookResult, IHookDispatchOptions } from './interfaces/IPluginHooks.js';
import {
    INetworkInfo,
    IReindexCheck,
    ReindexAction,
} from './interfaces/IPluginInstallState.js';

/**
 * Plugin manager configuration
 */
export interface IPluginManagerConfig {
    /** Directory containing plugin files */
    pluginsDir: string;
    /** Network for signature verification */
    network: Network;
    /** Node version for compatibility check */
    nodeVersion: string;
    /** Worker pool configuration */
    workerPool?: IWorkerPoolConfig;
    /** Whether to enable plugins on load (default: true) */
    autoEnable?: boolean;
    /** Whether to enable hot reload (default: false) */
    hotReload?: boolean;
    /** Chain ID for network awareness */
    chainId: bigint;
    /** Network type for network awareness */
    networkType: 'mainnet' | 'testnet' | 'regtest';
    /** Genesis block hash */
    genesisBlockHash: string;
    /** Whether reindex mode is enabled */
    reindexEnabled?: boolean;
    /** Block height to reindex from (0 = full reindex) */
    reindexFromBlock?: bigint;
}

/**
 * Plugin Manager
 */
export class PluginManager extends Logger {
    public readonly logColor: string = '#673AB7';

    private readonly config: IPluginManagerConfig;
    private readonly loader: PluginLoader;
    private readonly validator: PluginValidator;
    private readonly registry: PluginRegistry;
    private readonly workerPool: PluginWorkerPool;
    private readonly hookDispatcher: HookDispatcher;
    private readonly opcodeRegistry: PluginOpcodeRegistry;
    private readonly routeRegistry: PluginRouteRegistry;

    private initialized = false;
    private currentBlockHeight: bigint = 0n;

    // Hot reload
    private hotReloadEnabled = false;
    private fileWatcher?: FSWatcher;
    private reloadDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private readonly reloadDebounceMs = 100; // Wait 100ms before processing file changes

    constructor(config: IPluginManagerConfig) {
        super();

        this.config = {
            ...config,
            autoEnable: config.autoEnable ?? true,
        };

        this.loader = new PluginLoader(config.pluginsDir);
        this.validator = new PluginValidator(config.network, config.nodeVersion);
        this.registry = new PluginRegistry();
        this.workerPool = new PluginWorkerPool(config.workerPool);
        this.hookDispatcher = new HookDispatcher(this.registry, this.workerPool);
        this.opcodeRegistry = new PluginOpcodeRegistry(this.registry, this.workerPool);
        this.routeRegistry = new PluginRouteRegistry(this.registry, this.workerPool);

        // Set up crash handler
        this.workerPool.onPluginCrash = this.handlePluginCrash.bind(this);
    }

    /**
     * Initialize the plugin system
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            throw new Error('Plugin manager already initialized');
        }

        this.info('Initializing plugin system...');

        // Ensure plugins directory exists
        if (!fs.existsSync(this.config.pluginsDir)) {
            fs.mkdirSync(this.config.pluginsDir, { recursive: true });
            this.info(`Created plugins directory: ${this.config.pluginsDir}`);
        }

        // Initialize worker pool
        await this.workerPool.initialize();

        // Discover and load plugins
        await this.discoverAndLoadPlugins();

        // Enable hot reload if configured
        if (this.config.hotReload) {
            this.enableHotReload();
        }

        this.initialized = true;
        this.info('Plugin system initialized');
    }

    /**
     * Shutdown the plugin system
     */
    public async shutdown(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        this.info('Shutting down plugin system...');

        // Disable hot reload if enabled
        if (this.hotReloadEnabled) {
            this.disableHotReload();
        }

        // Get unload order (dependents first)
        const unloadOrder = this.registry.getUnloadOrder();

        // Disable and unload all plugins
        for (const plugin of unloadOrder) {
            try {
                if (plugin.state === PluginState.ENABLED) {
                    await this.disablePlugin(plugin.id);
                }
                if (plugin.state === PluginState.LOADED || plugin.state === PluginState.DISABLED) {
                    await this.unloadPlugin(plugin.id);
                }
            } catch (error) {
                this.error(`Error shutting down plugin ${plugin.id}: ${error}`);
            }
        }

        // Shutdown worker pool
        await this.workerPool.shutdown();

        this.initialized = false;
        this.info('Plugin system shutdown complete');
    }

    /**
     * Get current network information
     */
    public getNetworkInfo(): INetworkInfo {
        return {
            chainId: this.config.chainId,
            network: this.config.networkType,
            currentBlockHeight: this.currentBlockHeight,
            genesisBlockHash: this.config.genesisBlockHash,
            reindex: this.config.reindexEnabled
                ? {
                      enabled: true,
                      fromBlock: this.config.reindexFromBlock ?? 0n,
                      inProgress: false,
                  }
                : undefined,
        };
    }

    /**
     * Get current block height
     */
    public getCurrentBlockHeight(): bigint {
        return this.currentBlockHeight;
    }

    /**
     * Set current block height (called by indexer on new blocks)
     */
    public setCurrentBlockHeight(height: bigint): void {
        this.currentBlockHeight = height;
    }

    /**
     * Discover and load all plugins
     */
    private async discoverAndLoadPlugins(): Promise<void> {
        // Discover plugin files
        const pluginFiles = this.loader.discoverPlugins();

        if (pluginFiles.length === 0) {
            this.info('No plugins found');
            return;
        }

        // Parse and register each plugin
        for (const filePath of pluginFiles) {
            try {
                this.registerPlugin(filePath);
            } catch (error) {
                this.error(`Failed to register plugin from ${filePath}: ${error}`);
            }
        }

        // Resolve dependencies and get load order
        let loadOrder: IRegisteredPlugin[];
        try {
            loadOrder = this.registry.resolveDependencies();
        } catch (error) {
            if (error instanceof DependencyResolutionError) {
                this.error(`Dependency resolution failed: ${error.message}`);
            }
            throw error;
        }

        // Load plugins in dependency order
        for (const plugin of loadOrder) {
            try {
                await this.loadPlugin(plugin.id);

                // Auto-enable if configured
                if (this.config.autoEnable && plugin.metadata.lifecycle?.enabledByDefault !== false) {
                    await this.enablePlugin(plugin.id);
                }
            } catch (error) {
                this.error(`Failed to load plugin ${plugin.id}: ${error}`);
            }
        }
    }

    /**
     * Register a plugin from file
     */
    public registerPlugin(filePath: string): IRegisteredPlugin {
        this.info(`Registering plugin from: ${filePath}`);

        // Parse plugin file
        let parsedFile: IParsedPluginFile;
        try {
            parsedFile = this.loader.parsePluginFile(filePath);
        } catch (error) {
            if (error instanceof PluginLoadError) {
                throw error;
            }
            throw new PluginLoadError(`Parse error: ${error}`, 'PARSE_FAILED', filePath);
        }

        // Register in registry
        const plugin = this.registry.register(filePath, parsedFile);

        // Validate plugin
        const validationResult = this.validator.validate(parsedFile);

        if (!validationResult.valid) {
            const errors = validationResult.errors.map((e) => e.message).join('; ');
            this.registry.setState(plugin.id, PluginState.ERROR, {
                code: 'VALIDATION_FAILED',
                message: errors,
                timestamp: Date.now(),
            });
            throw new PluginValidationError(errors, 'VALIDATION_FAILED');
        }

        // Log warnings
        for (const warning of validationResult.warnings) {
            this.warn(`Plugin ${plugin.id}: ${warning}`);
        }

        // Update state
        this.registry.setState(plugin.id, PluginState.VALIDATED);

        return plugin;
    }

    /**
     * Load a plugin into a worker
     */
    public async loadPlugin(pluginId: string): Promise<void> {
        const plugin = this.registry.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        if (plugin.state !== PluginState.VALIDATED && plugin.state !== PluginState.DISCOVERED) {
            throw new Error(`Plugin ${pluginId} cannot be loaded from state ${plugin.state}`);
        }

        // Check dependencies are ready
        if (!this.registry.areDependenciesReady(pluginId)) {
            throw new Error(`Dependencies not ready for plugin ${pluginId}`);
        }

        this.registry.setState(pluginId, PluginState.LOADING);

        try {
            // Create plugin data directory
            const dataDir = this.loader.createPluginDataDir(pluginId);

            // Load config (from data directory if exists)
            const config = this.loadPluginConfig(pluginId, dataDir);

            // Build network info
            const networkInfo = this.getNetworkInfo();

            // Load into worker pool with network info
            await this.workerPool.loadPlugin(plugin, config, networkInfo);

            // Register WebSocket handlers if the plugin has them
            this.opcodeRegistry.registerPlugin(plugin);

            // Register HTTP routes if the plugin has them
            this.routeRegistry.registerPlugin(plugin);

            this.registry.setState(pluginId, PluginState.LOADED);
            this.info(`Loaded plugin: ${pluginId}`);
        } catch (error) {
            const err = error as Error;
            this.registry.setState(pluginId, PluginState.ERROR, {
                code: 'LOAD_FAILED',
                message: err.message,
                stack: err.stack,
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    /**
     * Unload a plugin from its worker
     */
    public async unloadPlugin(pluginId: string): Promise<void> {
        const plugin = this.registry.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        // Check no dependents are still enabled
        const dependents = this.registry.getDependents(pluginId);
        const enabledDependents = dependents.filter((d) => d.state === PluginState.ENABLED);
        if (enabledDependents.length > 0) {
            throw new Error(
                `Cannot unload ${pluginId}: dependents still enabled: ${enabledDependents.map((d) => d.id).join(', ')}`,
            );
        }

        this.registry.setState(pluginId, PluginState.UNLOADING);

        try {
            // Unregister WebSocket handlers
            this.opcodeRegistry.unregisterPlugin(pluginId);

            // Unregister HTTP routes
            this.routeRegistry.unregisterPlugin(pluginId);

            await this.workerPool.unloadPlugin(pluginId);
            this.registry.unregister(pluginId);
            this.info(`Unloaded plugin: ${pluginId}`);
        } catch (error) {
            // Even on error, mark as unloaded
            this.registry.unregister(pluginId);
            throw error;
        }
    }

    /**
     * Enable a plugin
     */
    public async enablePlugin(pluginId: string): Promise<void> {
        const plugin = this.registry.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        if (
            plugin.state !== PluginState.LOADED &&
            plugin.state !== PluginState.DISABLED &&
            plugin.state !== PluginState.CRASHED
        ) {
            throw new Error(`Plugin ${pluginId} cannot be enabled from state ${plugin.state}`);
        }

        try {
            await this.workerPool.enablePlugin(pluginId);
            this.registry.setState(pluginId, PluginState.ENABLED);
            this.info(`Enabled plugin: ${pluginId}`);
        } catch (error) {
            const err = error as Error;
            this.registry.setState(pluginId, PluginState.ERROR, {
                code: 'ENABLE_FAILED',
                message: err.message,
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    /**
     * Disable a plugin
     */
    public async disablePlugin(pluginId: string): Promise<void> {
        const plugin = this.registry.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        if (plugin.state !== PluginState.ENABLED) {
            throw new Error(`Plugin ${pluginId} is not enabled`);
        }

        try {
            await this.workerPool.disablePlugin(pluginId);
            this.registry.setState(pluginId, PluginState.DISABLED);
            this.info(`Disabled plugin: ${pluginId}`);
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to disable plugin ${pluginId}: ${err.message}`);
            throw error;
        }
    }

    /**
     * Reload a plugin (unload and re-load)
     */
    public async reloadPlugin(pluginId: string): Promise<void> {
        const plugin = this.registry.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        this.info(`Reloading plugin: ${pluginId}`);

        const wasEnabled = plugin.state === PluginState.ENABLED;
        const filePath = plugin.filePath;

        // Validate the new plugin file first
        let newParsedFile: IParsedPluginFile;
        try {
            newParsedFile = this.loader.parsePluginFile(filePath);
            const validationResult = this.validator.validate(newParsedFile);

            if (!validationResult.valid) {
                const errors = validationResult.errors.map((e) => e.message).join('; ');
                throw new PluginValidationError(errors, 'VALIDATION_FAILED');
            }

            // Log warnings
            for (const warning of validationResult.warnings) {
                this.warn(`Plugin ${pluginId}: ${warning}`);
            }
        } catch (error) {
            this.error(`Failed to validate new version of ${pluginId}: ${error}`);
            throw new Error(`Reload aborted: validation failed - ${error}`);
        }

        // Get dependents to reload (store their states)
        const dependents = this.registry.getDependents(pluginId);
        const dependentStates = new Map<string, { enabled: boolean; filePath: string }>();

        for (const dep of dependents) {
            dependentStates.set(dep.id, {
                enabled: dep.state === PluginState.ENABLED,
                filePath: dep.filePath,
            });
        }

        try {
            // Disable and unload dependents in reverse order
            for (const dep of [...dependents].reverse()) {
                if (dep.state === PluginState.ENABLED) {
                    await this.disablePlugin(dep.id);
                }
                if (dep.state === PluginState.LOADED || dep.state === PluginState.DISABLED) {
                    await this.unloadPlugin(dep.id);
                }
            }

            // Disable and unload target plugin
            if (wasEnabled) {
                await this.disablePlugin(pluginId);
            }
            await this.unloadPlugin(pluginId);

            // Re-register and load with new version
            this.registerPlugin(filePath);
            await this.loadPlugin(pluginId);

            if (wasEnabled) {
                await this.enablePlugin(pluginId);
            }

            // Reload dependents in dependency order
            for (const dep of dependents) {
                const depState = dependentStates.get(dep.id);
                if (depState) {
                    try {
                        this.registerPlugin(depState.filePath);
                        await this.loadPlugin(dep.id);
                        if (depState.enabled) {
                            await this.enablePlugin(dep.id);
                        }
                    } catch (error) {
                        this.error(`Failed to reload dependent plugin ${dep.id}: ${error}`);
                    }
                }
            }

            this.info(`Successfully reloaded plugin: ${pluginId}`);
        } catch (error) {
            this.error(`Failed to reload plugin ${pluginId}: ${error}`);
            throw error;
        }
    }

    /**
     * Enable hot reload - watch for file changes
     */
    public enableHotReload(): void {
        if (this.hotReloadEnabled) {
            this.warn('Hot reload already enabled');
            return;
        }

        if (!fs.existsSync(this.config.pluginsDir)) {
            this.warn(`Cannot enable hot reload: plugins directory does not exist: ${this.config.pluginsDir}`);
            return;
        }

        this.info('Enabling hot reload for plugins directory');

        try {
            this.fileWatcher = fs.watch(
                this.config.pluginsDir,
                { recursive: false, persistent: true },
                (eventType, filename) => {
                    if (filename) {
                        this.handleFileChange(eventType, filename);
                    }
                }
            );

            this.hotReloadEnabled = true;
            this.info('Hot reload enabled');
        } catch (error) {
            this.error(`Failed to enable hot reload: ${error}`);
            throw error;
        }
    }

    /**
     * Disable hot reload - stop watching for file changes
     */
    public disableHotReload(): void {
        if (!this.hotReloadEnabled) {
            return;
        }

        this.info('Disabling hot reload');

        // Clear all pending debounce timers
        for (const timer of this.reloadDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this.reloadDebounceTimers.clear();

        // Close file watcher
        if (this.fileWatcher) {
            this.fileWatcher.close();
            this.fileWatcher = undefined;
        }

        this.hotReloadEnabled = false;
        this.info('Hot reload disabled');
    }

    /**
     * Handle file system change events
     */
    private handleFileChange(eventType: string, filename: string): void {
        // Only process .opnet files
        if (!filename.endsWith('.opnet')) {
            return;
        }

        const filePath = path.join(this.config.pluginsDir, filename);
        const pluginId = filename.replace('.opnet', '');

        // Clear existing debounce timer for this file
        const existingTimer = this.reloadDebounceTimers.get(filename);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Debounce the file change event
        const timer = setTimeout(() => {
            this.reloadDebounceTimers.delete(filename);
            this.processFileChange(eventType, filePath, pluginId, filename).catch((error: unknown) => {
                this.error(`Hot reload error for ${filename}: ${error}`);
            });
        }, this.reloadDebounceMs);

        this.reloadDebounceTimers.set(filename, timer);
    }

    /**
     * Process file change after debounce
     */
    private async processFileChange(
        eventType: string,
        filePath: string,
        pluginId: string,
        filename: string
    ): Promise<void> {
        const fileExists = fs.existsSync(filePath);
        const pluginExists = this.registry.get(pluginId) !== undefined;

        this.info(`File change detected: ${filename} (event: ${eventType}, exists: ${fileExists})`);

        try {
            if (eventType === 'rename' && !fileExists && pluginExists) {
                // File was deleted
                await this.handlePluginRemoved(pluginId);
            } else if (eventType === 'rename' && fileExists && !pluginExists) {
                // File was added
                await this.handlePluginAdded(filePath);
            } else if (eventType === 'change' && fileExists && pluginExists) {
                // File was modified
                await this.handlePluginModified(pluginId);
            } else if (fileExists && pluginExists) {
                // Generic change - treat as modification
                await this.handlePluginModified(pluginId);
            }
        } catch (error) {
            this.error(`Error processing file change for ${filename}: ${error}`);
        }
    }

    /**
     * Handle plugin file added
     */
    private async handlePluginAdded(filePath: string): Promise<void> {
        this.info(`New plugin detected: ${path.basename(filePath)}`);

        try {
            await this.loadNewPlugin(filePath);
            this.info(`Successfully loaded new plugin from ${path.basename(filePath)}`);
        } catch (error) {
            this.error(`Failed to load new plugin from ${path.basename(filePath)}: ${error}`);
        }
    }

    /**
     * Handle plugin file modified
     */
    private async handlePluginModified(pluginId: string): Promise<void> {
        this.info(`Plugin modification detected: ${pluginId}`);

        try {
            await this.reloadPlugin(pluginId);
        } catch (error) {
            this.error(`Failed to reload modified plugin ${pluginId}: ${error}`);
            // Note: Old version is still running if reload failed
        }
    }

    /**
     * Handle plugin file removed
     */
    private async handlePluginRemoved(pluginId: string): Promise<void> {
        this.info(`Plugin removal detected: ${pluginId}`);

        const plugin = this.registry.get(pluginId);
        if (!plugin) {
            return;
        }

        try {
            // Get all dependents
            const dependents = this.registry.getDependents(pluginId);

            if (dependents.length > 0) {
                this.warn(
                    `Plugin ${pluginId} has dependents: ${dependents.map(d => d.id).join(', ')}. ` +
                    `They will be disabled.`
                );

                // Disable and unload dependents first
                for (const dep of [...dependents].reverse()) {
                    if (dep.state === PluginState.ENABLED) {
                        await this.disablePlugin(dep.id);
                    }
                    if (dep.state === PluginState.LOADED || dep.state === PluginState.DISABLED) {
                        await this.unloadPlugin(dep.id);
                    }
                }
            }

            // Disable and unload the plugin
            if (plugin.state === PluginState.ENABLED) {
                await this.disablePlugin(pluginId);
            }
            if (plugin.state === PluginState.LOADED || plugin.state === PluginState.DISABLED) {
                await this.unloadPlugin(pluginId);
            }

            this.info(`Successfully removed plugin: ${pluginId}`);
        } catch (error) {
            this.error(`Failed to remove plugin ${pluginId}: ${error}`);
        }
    }

    /**
     * Load a new plugin file at runtime
     */
    public async loadNewPlugin(filePath: string): Promise<IRegisteredPlugin> {
        const plugin = this.registerPlugin(filePath);
        await this.loadPlugin(plugin.id);

        if (this.config.autoEnable && plugin.metadata.lifecycle?.enabledByDefault !== false) {
            await this.enablePlugin(plugin.id);
        }

        return plugin;
    }

    /**
     * Get the hook dispatcher for direct hook calls
     */
    public get hooks(): HookDispatcher {
        return this.hookDispatcher;
    }

    /**
     * Get the WebSocket opcode registry
     */
    public get websocketOpcodes(): PluginOpcodeRegistry {
        return this.opcodeRegistry;
    }

    /**
     * Get the HTTP route registry
     */
    public get httpRoutes(): PluginRouteRegistry {
        return this.routeRegistry;
    }

    /**
     * Dispatch block pre-process hook to all plugins
     * Called with raw Bitcoin block data from RPC
     */
    public async onBlockPreProcess(
        block: BlockDataWithTransactionData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.hookDispatcher.dispatchBlockPreProcess(block, options);
    }

    /**
     * Dispatch block post-process hook to all plugins
     * Called with OPNet processed block data
     */
    public async onBlockPostProcess(
        block: BlockProcessedData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.hookDispatcher.dispatchBlockPostProcess(block, options);
    }

    /**
     * Dispatch block change hook to all plugins
     * Called when a block is confirmed with OPNet processed data
     */
    public async onBlockChange(
        block: BlockProcessedData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.hookDispatcher.dispatchBlockChange(block, options);
    }

    /**
     * Dispatch epoch change hook to all plugins
     */
    public async onEpochChange(
        epoch: IEpochData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.hookDispatcher.dispatchEpochChange(epoch, options);
    }

    /**
     * Dispatch epoch finalized hook to all plugins
     */
    public async onEpochFinalized(
        epoch: IEpochData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.hookDispatcher.dispatchEpochFinalized(epoch, options);
    }

    /**
     * Dispatch mempool transaction hook to all plugins
     */
    public async onMempoolTransaction(
        tx: IMempoolTransaction,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.hookDispatcher.dispatchMempoolTransaction(tx, options);
    }

    /**
     * Dispatch reorg hook to all plugins (BLOCKING)
     * CRITICAL: This method blocks until ALL plugins have completed their reorg handling
     * Plugins must revert any state they have stored for blocks >= fromBlock
     *
     * @param reorg - Reorg data containing fromBlock, toBlock, and reason
     * @param options - Hook dispatch options
     * @returns Hook results from all plugins
     */
    public async onReorg(
        reorg: IReorgData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.hookDispatcher.dispatchReorg(reorg, options);
    }

    /**
     * Handle reindex requirements for all plugins (BLOCKING)
     * CRITICAL: This method MUST be called at startup when reindex is enabled.
     * It blocks until ALL plugins have completed their reindex handling.
     *
     * @throws Error if any plugin cannot handle the required reindex action
     */
    public async handleReindex(): Promise<void> {
        if (!this.config.reindexEnabled) {
            return;
        }

        const reindexFromBlock = this.config.reindexFromBlock ?? 0n;
        this.info(`Reindex mode enabled - handling plugin reindex from block ${reindexFromBlock}`);

        const enabledPlugins = this.registry.getEnabled();
        if (enabledPlugins.length === 0) {
            this.info('No enabled plugins to handle reindex');
            return;
        }

        for (const plugin of enabledPlugins) {
            const pluginId = plugin.id;

            // Get plugin's sync state from worker
            const syncState = await this.workerPool.getPluginSyncState(pluginId);
            const lastSyncedBlock = syncState?.lastSyncedBlock ?? 0n;

            // Build reindex check
            const reindexCheck = this.buildReindexCheck(lastSyncedBlock, reindexFromBlock);

            if (reindexCheck.action === ReindexAction.NONE) {
                this.info(`Plugin ${pluginId}: No reindex action required (lastSynced=${lastSyncedBlock})`);
                continue;
            }

            this.info(
                `Plugin ${pluginId}: Reindex action=${reindexCheck.action}, ` +
                    `lastSynced=${lastSyncedBlock}, reindexFrom=${reindexFromBlock}`,
            );

            // Call onReindexRequired hook (BLOCKING)
            const result = await this.hookDispatcher.dispatchReindexRequired(pluginId, reindexCheck);

            if (!result.success) {
                throw new Error(
                    `Plugin ${pluginId} failed to handle reindex: ${result.error || 'Unknown error'}`,
                );
            }

            // If plugin returned false (cannot handle), abort startup
            if (result.result === false) {
                throw new Error(
                    `Plugin ${pluginId} cannot handle required reindex action: ${reindexCheck.action}`,
                );
            }

            // If purge is required and plugin didn't handle it via onReindexRequired,
            // call onPurgeBlocks explicitly
            if (reindexCheck.requiresPurge && reindexCheck.purgeToBlock !== undefined) {
                this.info(`Plugin ${pluginId}: Purging data from block ${reindexCheck.purgeToBlock} onwards`);

                const purgeResult = await this.hookDispatcher.dispatchPurgeBlocks(
                    pluginId,
                    reindexCheck.purgeToBlock,
                    undefined, // toBlock: undefined means purge all blocks >= fromBlock
                );

                if (!purgeResult.success) {
                    throw new Error(
                        `Plugin ${pluginId} failed to purge blocks: ${purgeResult.error || 'Unknown error'}`,
                    );
                }

                // Reset plugin's sync state to the reindex block
                await this.workerPool.resetPluginSyncState(pluginId, reindexCheck.purgeToBlock);
                this.info(`Plugin ${pluginId}: Sync state reset to block ${reindexCheck.purgeToBlock}`);
            }

            this.success(`Plugin ${pluginId}: Reindex handling complete`);
        }

        this.success('All plugins handled reindex requirements');
    }

    /**
     * Build a reindex check for a plugin based on its sync state
     */
    private buildReindexCheck(lastSyncedBlock: bigint, reindexFromBlock: bigint): IReindexCheck {
        let action: ReindexAction;
        let requiresPurge = false;
        let purgeToBlock: bigint | undefined;
        let requiresSync = false;
        let syncFromBlock: bigint | undefined;
        let syncToBlock: bigint | undefined;

        if (lastSyncedBlock > reindexFromBlock) {
            // Plugin has data beyond reindex point - needs to purge
            action = ReindexAction.PURGE;
            requiresPurge = true;
            purgeToBlock = reindexFromBlock;
            // After purge, will need to sync from reindex point
            requiresSync = true;
            syncFromBlock = reindexFromBlock;
            syncToBlock = reindexFromBlock;
        } else if (lastSyncedBlock < reindexFromBlock) {
            // Plugin is behind reindex point - just needs to sync up to it
            action = ReindexAction.SYNC;
            requiresSync = true;
            syncFromBlock = lastSyncedBlock;
            syncToBlock = reindexFromBlock;
        } else {
            // Plugin is exactly at reindex point - no action needed
            action = ReindexAction.NONE;
        }

        return {
            reindexEnabled: true,
            reindexFromBlock,
            pluginLastSyncedBlock: lastSyncedBlock,
            action,
            requiresPurge,
            purgeToBlock,
            requiresSync,
            syncFromBlock,
            syncToBlock,
        };
    }

    /**
     * Get a plugin by ID
     */
    public getPlugin(pluginId: string): IRegisteredPlugin | undefined {
        return this.registry.get(pluginId);
    }

    /**
     * Get all plugins
     */
    public getAllPlugins(): IRegisteredPlugin[] {
        return this.registry.getAll();
    }

    /**
     * Get enabled plugins
     */
    public getEnabledPlugins(): IRegisteredPlugin[] {
        return this.registry.getEnabled();
    }

    /**
     * Get plugins by state
     */
    public getPluginsByState(state: PluginState): IRegisteredPlugin[] {
        return this.registry.getByState(state);
    }

    /**
     * Execute a route handler in the plugin worker
     */
    public async executeRouteHandler(
        pluginId: string,
        handler: string,
        request: Record<string, unknown>,
    ): Promise<{ success: boolean; status?: number; result?: string; error?: string }> {
        return this.workerPool.executeRouteHandler(pluginId, handler, request);
    }

    /**
     * Execute a WebSocket handler in the plugin worker
     */
    public async executeWsHandler(
        pluginId: string,
        handler: string,
        request: unknown,
        requestId: string,
        clientId: string,
    ): Promise<{ success: boolean; result?: string; error?: string }> {
        return this.workerPool.executeWsHandler(pluginId, handler, request, requestId, clientId);
    }

    /**
     * Execute a WebSocket handler with raw protobuf payload (for cross-thread execution)
     * Handles decode/encode of protobuf messages using PluginOpcodeRegistry
     */
    public async executeWsHandlerRaw(
        requestOpcode: number,
        rawPayload: Uint8Array,
        requestId: string,
        clientId: string,
    ): Promise<{ success: boolean; response?: Uint8Array; error?: string }> {
        // Get handler by opcode
        const handler = this.websocketOpcodes.getHandler(requestOpcode);
        if (!handler) {
            return { success: false, error: `Unknown opcode 0x${requestOpcode.toString(16)}` };
        }

        try {
            // Decode the raw protobuf request
            const decodedRequest = this.websocketOpcodes.decodeRequest(handler, rawPayload);

            // Execute the handler via worker pool
            const result = await this.workerPool.executeWsHandler(
                handler.pluginId,
                handler.handler,
                decodedRequest,
                requestId,
                clientId,
            );

            if (!result.success) {
                return { success: false, error: result.error || 'Handler failed' };
            }

            // Parse the JSON result from worker
            let responseData: unknown;
            if (result.result) {
                try {
                    responseData = JSON.parse(result.result);
                } catch {
                    return { success: false, error: 'Invalid JSON response from plugin' };
                }
            }

            // Encode the response using protobuf
            const encodedResponse = this.websocketOpcodes.encodeResponse(handler, responseData);

            return { success: true, response: encodedResponse };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: err.message };
        }
    }

    /**
     * Get worker pool stats
     */
    public getWorkerStats(): ReturnType<PluginWorkerPool['getStats']> {
        return this.workerPool.getStats();
    }

    /**
     * Check if plugin system is initialized
     */
    public isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Check if hot reload is enabled
     */
    public isHotReloadEnabled(): boolean {
        return this.hotReloadEnabled;
    }

    /**
     * Handle plugin crash
     */
    private handlePluginCrash(pluginId: string, error: string): void {
        this.error(`Plugin ${pluginId} crashed: ${error}`);

        const plugin = this.registry.get(pluginId);
        if (plugin) {
            this.registry.setState(pluginId, PluginState.CRASHED, {
                code: 'PLUGIN_CRASHED',
                message: error,
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Load plugin configuration from data directory
     */
    private loadPluginConfig(pluginId: string, dataDir: string): Record<string, unknown> {
        const configPath = path.join(dataDir, 'config.json');

        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, 'utf8');
                return JSON.parse(content) as Record<string, unknown>;
            } catch (error) {
                this.warn(`Failed to load config for ${pluginId}: ${error}`);
            }
        }

        return {};
    }
}
