import { Collection, Db, Document, Filter, FindCursor, Sort } from 'mongodb';
import {
    IPluginDatabaseAPI,
    IPluginCollection,
    IPluginCursor,
} from '../context/PluginContext.js';

/**
 * Plugin database error
 */
export class PluginDatabaseError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly collection?: string,
    ) {
        super(message);
        this.name = 'PluginDatabaseError';
    }
}

/**
 * Plugin cursor wrapper
 * Wraps MongoDB cursor with a plugin-safe interface
 */
class PluginCursor implements IPluginCursor {
    private cursor: FindCursor<Document>;
    private _limit?: number;
    private _skip?: number;
    private _sort?: Sort;

    constructor(cursor: FindCursor<Document>) {
        this.cursor = cursor;
    }

    public async toArray(): Promise<Record<string, unknown>[]> {
        if (this._limit !== undefined) {
            this.cursor = this.cursor.limit(this._limit);
        }
        if (this._skip !== undefined) {
            this.cursor = this.cursor.skip(this._skip);
        }
        if (this._sort !== undefined) {
            this.cursor = this.cursor.sort(this._sort);
        }
        const docs = await this.cursor.toArray();
        return docs as Record<string, unknown>[];
    }

    public limit(count: number): IPluginCursor {
        this._limit = count;
        return this;
    }

    public skip(count: number): IPluginCursor {
        this._skip = count;
        return this;
    }

    public sort(spec: Record<string, 1 | -1>): IPluginCursor {
        this._sort = spec as Sort;
        return this;
    }
}

/**
 * Plugin collection wrapper
 * Wraps MongoDB collection with a plugin-safe interface
 */
class PluginCollection implements IPluginCollection {
    private collection: Collection<Document>;

    constructor(collection: Collection<Document>) {
        this.collection = collection;
    }

    public find(query: Record<string, unknown>): IPluginCursor {
        const cursor = this.collection.find(query as Filter<Document>);
        return new PluginCursor(cursor);
    }

    public async findOne(query: Record<string, unknown>): Promise<Record<string, unknown> | null> {
        const doc = await this.collection.findOne(query as Filter<Document>);
        return doc as Record<string, unknown> | null;
    }

    public async insertOne(doc: Record<string, unknown>): Promise<{ insertedId: string }> {
        const result = await this.collection.insertOne(doc as Document);
        return { insertedId: result.insertedId.toString() };
    }

    public async insertMany(docs: Record<string, unknown>[]): Promise<{ insertedIds: string[] }> {
        const result = await this.collection.insertMany(docs as Document[]);
        const insertedIds = Object.values(result.insertedIds).map((id) => id.toString());
        return { insertedIds };
    }

    public async updateOne(
        query: Record<string, unknown>,
        update: Record<string, unknown>,
    ): Promise<{ modifiedCount: number }> {
        const result = await this.collection.updateOne(
            query as Filter<Document>,
            update as Document,
        );
        return { modifiedCount: result.modifiedCount };
    }

    public async updateMany(
        query: Record<string, unknown>,
        update: Record<string, unknown>,
    ): Promise<{ modifiedCount: number }> {
        const result = await this.collection.updateMany(
            query as Filter<Document>,
            update as Document,
        );
        return { modifiedCount: result.modifiedCount };
    }

    public async deleteOne(query: Record<string, unknown>): Promise<{ deletedCount: number }> {
        const result = await this.collection.deleteOne(query as Filter<Document>);
        return { deletedCount: result.deletedCount };
    }

    public async deleteMany(query: Record<string, unknown>): Promise<{ deletedCount: number }> {
        const result = await this.collection.deleteMany(query as Filter<Document>);
        return { deletedCount: result.deletedCount };
    }

    public async countDocuments(query?: Record<string, unknown>): Promise<number> {
        return await this.collection.countDocuments(query as Filter<Document>);
    }

    public async createIndex(
        keys: Record<string, 1 | -1>,
        options?: { name?: string; unique?: boolean; sparse?: boolean },
    ): Promise<string> {
        return await this.collection.createIndex(keys, options);
    }
}

/**
 * Plugin Database API
 * Provides MongoDB access to plugins with namespaced collections
 */
export class PluginDatabaseAPI implements IPluginDatabaseAPI {
    private readonly db: Db;
    private readonly pluginId: string;
    private readonly permittedCollections: Set<string>;
    private readonly collectionCache: Map<string, PluginCollection> = new Map();

    constructor(pluginId: string, permittedCollections: string[], db: Db) {
        this.pluginId = pluginId;
        this.permittedCollections = new Set(permittedCollections);
        this.db = db;
    }

    /**
     * Get a collection by name
     * Collection names are automatically prefixed with the plugin ID
     */
    public collection(name: string): IPluginCollection {
        if (!this.permittedCollections.has(name)) {
            throw new PluginDatabaseError(
                `Collection "${name}" is not permitted for plugin "${this.pluginId}"`,
                'COLLECTION_NOT_PERMITTED',
                name,
            );
        }

        // Check cache
        const cached = this.collectionCache.get(name);
        if (cached) {
            return cached;
        }

        // Create prefixed collection name
        const prefixedName = `${this.pluginId}_${name}`;
        const mongoCollection = this.db.collection(prefixedName);
        const pluginCollection = new PluginCollection(mongoCollection);

        this.collectionCache.set(name, pluginCollection);
        return pluginCollection;
    }

    /**
     * List all permitted collections for this plugin
     */
    public listCollections(): string[] {
        return [...this.permittedCollections];
    }
}
