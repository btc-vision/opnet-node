import { Logger } from '@btc-vision/bsi-common';
import { Collection, Db, Document } from 'mongodb';

import { IPluginInstallState } from '../interfaces/IPluginInstallState.js';

/**
 * MongoDB document structure for plugin state
 */
interface IPluginStateDocument extends Document {
    _id: string; // pluginId
    pluginId: string;
    installedVersion: string;
    chainId: string; // Stored as string for MongoDB compatibility
    network: string;
    installedAt: number;
    enabledAtBlock: string; // Stored as string for MongoDB compatibility
    lastSyncedBlock: string; // Stored as string for MongoDB compatibility
    syncCompleted: boolean;
    collections: string[];
    updatedAt: number;
}

/**
 * Plugin State Store
 * Persists plugin installation state to MongoDB
 */
export class PluginStateStore extends Logger {
    private static readonly COLLECTION_NAME = 'plugin_states';
    public readonly logColor: string = '#FF9800';
    private collection?: Collection<IPluginStateDocument>;
    private readonly stateCache: Map<string, IPluginInstallState> = new Map();

    /**
     * Initialize the state store with database connection
     */
    public async initialize(db: Db): Promise<void> {
        this.collection = db.collection<IPluginStateDocument>(PluginStateStore.COLLECTION_NAME);

        // Create index on pluginId
        await this.collection.createIndex({ pluginId: 1 }, { unique: true });

        // Load all states into cache
        const states = await this.collection.find({}).toArray();
        for (const doc of states) {
            this.stateCache.set(doc.pluginId, this.documentToState(doc));
        }

        this.info(`Loaded ${this.stateCache.size} plugin state(s) from database`);
    }

    /**
     * Get plugin state by ID
     */
    public get(pluginId: string): IPluginInstallState | undefined {
        return this.stateCache.get(pluginId);
    }

    /**
     * Check if a plugin has been installed before
     */
    public isInstalled(pluginId: string): boolean {
        return this.stateCache.has(pluginId);
    }

    /**
     * Check if a plugin state matches the expected network
     */
    public isCorrectNetwork(pluginId: string, chainId: bigint, network: string): boolean {
        const state = this.stateCache.get(pluginId);
        if (!state) return true; // New install, any network is fine

        return state.chainId === chainId && state.network === network;
    }

    /**
     * Create initial state for a new plugin installation
     */
    public async createInstallState(
        pluginId: string,
        version: string,
        chainId: bigint,
        network: string,
        enabledAtBlock: bigint,
        collections: string[],
    ): Promise<IPluginInstallState> {
        const now = Date.now();

        const state: IPluginInstallState = {
            pluginId,
            installedVersion: version,
            chainId,
            network,
            installedAt: now,
            enabledAtBlock,
            lastSyncedBlock: 0n,
            syncCompleted: false,
            collections,
            updatedAt: now,
        };

        const doc = this.stateToDocument(state);

        if (!this.collection) {
            throw new Error('PluginStateStore not initialized');
        }

        await this.collection.insertOne(doc);
        this.stateCache.set(pluginId, state);

        this.info(`Created install state for plugin: ${pluginId}`);
        return state;
    }

    /**
     * Update plugin state
     */
    public async updateState(
        pluginId: string,
        updates: Partial<
            Omit<IPluginInstallState, 'pluginId' | 'installedAt' | 'chainId' | 'network'>
        >,
    ): Promise<IPluginInstallState> {
        const existing = this.stateCache.get(pluginId);
        if (!existing) {
            throw new Error(`No install state found for plugin: ${pluginId}`);
        }

        const updatedState: IPluginInstallState = {
            ...existing,
            ...updates,
            updatedAt: Date.now(),
        };

        if (!this.collection) {
            throw new Error('PluginStateStore not initialized');
        }

        const doc = this.stateToDocument(updatedState);
        await this.collection.updateOne({ _id: pluginId }, { $set: doc });

        this.stateCache.set(pluginId, updatedState);
        return updatedState;
    }

    /**
     * Update last synced block
     */
    public async updateLastSyncedBlock(pluginId: string, blockHeight: bigint): Promise<void> {
        await this.updateState(pluginId, {
            lastSyncedBlock: blockHeight,
        });
    }

    /**
     * Mark plugin as sync completed
     */
    public async markSyncCompleted(pluginId: string, blockHeight: bigint): Promise<void> {
        await this.updateState(pluginId, {
            lastSyncedBlock: blockHeight,
            syncCompleted: true,
        });
    }

    /**
     * Add a collection to the plugin's tracked collections
     */
    public async addCollection(pluginId: string, collectionName: string): Promise<void> {
        const state = this.stateCache.get(pluginId);
        if (!state) {
            throw new Error(`No install state found for plugin: ${pluginId}`);
        }

        if (state.collections.includes(collectionName)) {
            return; // Already tracked
        }

        await this.updateState(pluginId, {
            collections: [...state.collections, collectionName],
        });
    }

    /**
     * Delete plugin state (for uninstall)
     */
    public async deleteState(pluginId: string): Promise<IPluginInstallState | undefined> {
        const state = this.stateCache.get(pluginId);
        if (!state) {
            return undefined;
        }

        if (!this.collection) {
            throw new Error('PluginStateStore not initialized');
        }

        await this.collection.deleteOne({ _id: pluginId });
        this.stateCache.delete(pluginId);

        this.info(`Deleted install state for plugin: ${pluginId}`);
        return state;
    }

    /**
     * Get all plugin states
     */
    public getAll(): IPluginInstallState[] {
        return Array.from(this.stateCache.values());
    }

    /**
     * Get plugins that need sync (not synced to current block)
     */
    public getPluginsNeedingSync(currentBlockHeight: bigint): IPluginInstallState[] {
        return this.getAll().filter(
            (state) => !state.syncCompleted || state.lastSyncedBlock < currentBlockHeight,
        );
    }

    /**
     * Convert MongoDB document to state object
     */
    private documentToState(doc: IPluginStateDocument): IPluginInstallState {
        return {
            pluginId: doc.pluginId,
            installedVersion: doc.installedVersion,
            chainId: BigInt(doc.chainId),
            network: doc.network,
            installedAt: doc.installedAt,
            enabledAtBlock: BigInt(doc.enabledAtBlock),
            lastSyncedBlock: BigInt(doc.lastSyncedBlock),
            syncCompleted: doc.syncCompleted,
            collections: doc.collections,
            updatedAt: doc.updatedAt,
        };
    }

    /**
     * Convert state object to MongoDB document
     */
    private stateToDocument(state: IPluginInstallState): IPluginStateDocument {
        return {
            _id: state.pluginId,
            pluginId: state.pluginId,
            installedVersion: state.installedVersion,
            chainId: state.chainId.toString(),
            network: state.network,
            installedAt: state.installedAt,
            enabledAtBlock: state.enabledAtBlock.toString(),
            lastSyncedBlock: state.lastSyncedBlock.toString(),
            syncCompleted: state.syncCompleted,
            collections: [...state.collections],
            updatedAt: state.updatedAt,
        };
    }
}
