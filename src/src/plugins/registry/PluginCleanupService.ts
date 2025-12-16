import { Logger } from '@btc-vision/bsi-common';
import { Db } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

import { PluginStateStore } from './PluginStateStore.js';
import { IPluginInstallState } from '../interfaces/IPluginInstallState.js';

/**
 * Cleanup result
 */
export interface ICleanupResult {
    readonly pluginId: string;
    readonly collectionsDropped: string[];
    readonly dataDirectoryDeleted: boolean;
    readonly stateDeleted: boolean;
    readonly errors: string[];
}

/**
 * Plugin Cleanup Service
 * Handles cleanup of plugin resources when uninstalled
 */
export class PluginCleanupService extends Logger {
    public readonly logColor: string = '#F44336';

    private db?: Db;
    private stateStore?: PluginStateStore;
    private pluginsDir?: string;

    /**
     * Initialize the cleanup service
     */
    public initialize(db: Db, stateStore: PluginStateStore, pluginsDir: string): void {
        this.db = db;
        this.stateStore = stateStore;
        this.pluginsDir = pluginsDir;
    }

    /**
     * Clean up all resources for a plugin
     * This should be called when a plugin is being permanently removed
     */
    public async cleanupPlugin(pluginId: string): Promise<ICleanupResult> {
        const result: ICleanupResult = {
            pluginId,
            collectionsDropped: [],
            dataDirectoryDeleted: false,
            stateDeleted: false,
            errors: [],
        };

        this.info(`Starting cleanup for plugin: ${pluginId}`);

        // Get the plugin's install state to know what to clean up
        const state = this.stateStore?.get(pluginId);

        // Drop database collections
        if (state && state.collections.length > 0) {
            const dropped = await this.dropCollections(pluginId, state.collections, result.errors);
            (result as { collectionsDropped: string[] }).collectionsDropped = dropped;
        }

        // Delete data directory
        const dataDirDeleted = this.deleteDataDirectory(pluginId, result.errors);
        (result as { dataDirectoryDeleted: boolean }).dataDirectoryDeleted = dataDirDeleted;

        // Delete install state from database
        if (this.stateStore) {
            try {
                await this.stateStore.deleteState(pluginId);
                (result as { stateDeleted: boolean }).stateDeleted = true;
            } catch (error) {
                const err = error as Error;
                result.errors.push(`Failed to delete state: ${err.message}`);
            }
        }

        if (result.errors.length > 0) {
            this.warn(`Cleanup completed for ${pluginId} with ${result.errors.length} error(s)`);
        } else {
            this.info(`Cleanup completed successfully for ${pluginId}`);
        }

        return result;
    }

    /**
     * List all collections that belong to a plugin
     */
    public async listPluginCollections(pluginId: string): Promise<string[]> {
        if (!this.db) {
            return [];
        }

        const prefix = `plugin_${pluginId}_`;
        const allCollections = await this.db.listCollections().toArray();

        return allCollections.map((c) => c.name).filter((name) => name.startsWith(prefix));
    }

    /**
     * Get the size of all plugin collections combined
     */
    public async getPluginStorageSize(pluginId: string): Promise<bigint> {
        if (!this.db) {
            return 0n;
        }

        const collections = await this.listPluginCollections(pluginId);
        let totalSize = 0n;

        for (const collectionName of collections) {
            try {
                const stats = (await this.db.command({ collStats: collectionName })) as {
                    storageSize?: number;
                };
                const storageSize = typeof stats.storageSize === 'number' ? stats.storageSize : 0;
                totalSize += BigInt(storageSize);
            } catch {
                // Collection might not exist or be empty
            }
        }

        return totalSize;
    }

    /**
     * Perform a dry run of cleanup (show what would be deleted)
     */
    public async previewCleanup(pluginId: string): Promise<{
        collections: string[];
        dataDirectory: string | null;
        state: IPluginInstallState | undefined;
    }> {
        const state = this.stateStore?.get(pluginId);
        const collections = await this.listPluginCollections(pluginId);

        let dataDirectory: string | null = null;
        if (this.pluginsDir) {
            const dataDir = path.join(this.pluginsDir, pluginId);
            if (fs.existsSync(dataDir)) {
                dataDirectory = dataDir;
            }
        }

        return {
            collections,
            dataDirectory,
            state,
        };
    }

    /**
     * Drop collections created by a plugin
     */
    private async dropCollections(
        pluginId: string,
        collections: readonly string[],
        errors: string[],
    ): Promise<string[]> {
        if (!this.db) {
            errors.push('Database not initialized');
            return [];
        }

        const dropped: string[] = [];

        for (const collectionName of collections) {
            try {
                // Verify the collection name starts with the plugin prefix for safety
                const expectedPrefix = `plugin_${pluginId}_`;
                if (!collectionName.startsWith(expectedPrefix)) {
                    this.warn(
                        `Skipping collection ${collectionName}: does not match expected prefix ${expectedPrefix}`,
                    );
                    continue;
                }

                // Check if collection exists
                const collectionsList = await this.db
                    .listCollections({ name: collectionName })
                    .toArray();
                if (collectionsList.length === 0) {
                    this.info(`Collection ${collectionName} does not exist, skipping`);
                    continue;
                }

                // Drop the collection
                await this.db.dropCollection(collectionName);
                dropped.push(collectionName);
                this.info(`Dropped collection: ${collectionName}`);
            } catch (error) {
                const err = error as Error;
                errors.push(`Failed to drop collection ${collectionName}: ${err.message}`);
                this.error(`Failed to drop collection ${collectionName}: ${err.message}`);
            }
        }

        return dropped;
    }

    /**
     * Delete plugin's data directory
     */
    private deleteDataDirectory(pluginId: string, errors: string[]): boolean {
        if (!this.pluginsDir) {
            errors.push('Plugins directory not configured');
            return false;
        }

        const dataDir = path.join(this.pluginsDir, pluginId);

        try {
            if (!fs.existsSync(dataDir)) {
                this.info(`Data directory does not exist: ${dataDir}`);
                return true; // Nothing to delete
            }

            // Recursively delete the directory
            fs.rmSync(dataDir, { recursive: true, force: true });
            this.info(`Deleted data directory: ${dataDir}`);
            return true;
        } catch (error) {
            const err = error as Error;
            errors.push(`Failed to delete data directory: ${err.message}`);
            this.error(`Failed to delete data directory ${dataDir}: ${err.message}`);
            return false;
        }
    }
}
