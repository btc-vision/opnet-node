import { ConfigurableDBManager, DebugLevel, Logger } from '@btc-vision/bsi-common';
import { Document } from 'bson';
import { Collection, CreateIndexesOptions, Db, IndexDescription, IndexDirection } from 'mongodb';
import { IndexedBlockchainInformation } from './required/IndexedBlockchainInformation.js';
import { IndexedBlocks } from './required/IndexedBlocks.js';
import { IndexedBlockWitnesses } from './required/IndexedBlockWitnesses.js';
import { IndexedCollection, OPNetCollections } from './required/IndexedCollection.js';
import { IndexedContracts } from './required/IndexedContracts.js';
import { IndexedInternalPointers } from './required/IndexedInternalPointers.js';
import { IndexedReorgs } from './required/IndexedReorgs.js';
import { IndexedTransactions } from './required/IndexedTransactions.js';
import { IndexedMempool } from './required/IndexedMempool.js';
import { IndexedUnspentTransactions } from './required/IndexedUnspentTransactions.js';
import { Config } from '../../config/Config.js';
import { IndexedPublicKeys } from './required/IndexedPublicKeys.js';
import { IndexedAnyoneCanSpend } from './required/IndexedAnyoneCanSpend.js';
import { IndexedEpochs } from './required/IndexedEpochs.js';
import { IndexedEpochSubmissions } from './required/IndexedEpochSubmissions.js';

/** This class job is to create the required indexes for the database */
export class IndexManager extends Logger {
    public readonly logColor: string = '#5dbcef';

    private readonly indexes: IndexedCollection<OPNetCollections>[] = [
        new IndexedBlocks(),
        new IndexedTransactions(),
        new IndexedBlockchainInformation(),
        new IndexedContracts(),
        new IndexedBlockWitnesses(),
        new IndexedInternalPointers(),
        new IndexedReorgs(),
        new IndexedMempool(),
        new IndexedAnyoneCanSpend(),
        new IndexedUnspentTransactions(),
        new IndexedPublicKeys(),
        new IndexedEpochs(),
        new IndexedEpochSubmissions(),
    ];

    constructor(private readonly opnetDB: ConfigurableDBManager) {
        super();
    }

    private get db(): Db {
        if (!this.opnetDB.db) throw new Error('Database not connected.');
        return this.opnetDB.db;
    }

    public async setupDB(): Promise<void> {
        this.opnetDB.setup();
        await this.opnetDB.connect();

        if (!this.opnetDB.db) {
            this.error('Database connection not established.');
            return;
        }

        await this.createCollections();
        await this.createIndexes();
    }

    private async createCollections(): Promise<void> {
        const collectionNames: string[] = await this.getCollections();

        await this.createCollectionsIfNotExist(collectionNames);
    }

    private async getCollections(): Promise<string[]> {
        const collections = await this.db.listCollections().toArray();

        return collections.map((collection) => collection.name);
    }

    private async createCollectionsIfNotExist(collectionNames: string[]): Promise<void> {
        const requiredCollections = this.indexes.map((index) => index.collection);

        const promises: Promise<void>[] = requiredCollections.map(async (collection) => {
            if (collectionNames.includes(collection)) return;

            this.log(`Creating collection ${collection}`);

            try {
                await this.db.createCollection(collection);
            } catch (e) {
                this.error(`Failed to create collection ${collection}: ${e}`);
            }
        });

        await Promise.safeAll(promises);
    }

    private getIndexName(index: IndexDescription): string {
        let indexName = '';

        const keys = Object.keys(index.key);
        for (let i: number = 0; i < keys.length; i++) {
            const key: string = keys[i];
            const keyVal: IndexDirection | undefined =
                index.key instanceof Map ? index.key.get(key) : index.key[key];

            if (keyVal === undefined) continue;

            if (indexName.length > 0) indexName += '_';
            indexName += `${key}_${keyVal}`;
        }

        return indexName;
    }

    private async createIndex(
        indexedCollection: IndexedCollection<OPNetCollections>,
    ): Promise<void> {
        const collection: Collection = this.db.collection(indexedCollection.collection);

        if (!collection) {
            this.error(`Collection ${indexedCollection.collection} not found.`);
            return;
        }

        const existingIndexes: Document[] = await collection.indexes();
        const existingIndexNames: string[] = existingIndexes.map((index) => index.name as string);

        for (const index of indexedCollection.getIndexes()) {
            const indexName: string = index.name || this.getIndexName(index);

            if (existingIndexNames.includes(indexName)) {
                continue;
            }

            this.log(`Creating index ${indexName} for collection ${indexedCollection.collection}`);

            const createIndexOptions: CreateIndexesOptions = {
                background: false,
                unique: index.unique || false,
                name: indexName,
            };

            try {
                await collection.createIndex(index.key, createIndexOptions);
            } catch (e) {
                this.error(
                    `Failed to create index ${indexName} for collection ${indexedCollection.collection}: ${e}`,
                );
            }
        }

        if (Config.DEV_MODE && Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.log(`Indexes created for collection ${indexedCollection.collection}`);
        }
    }

    private async createIndexes(): Promise<void> {
        const promises: Promise<void>[] = this.indexes.map(async (index) => {
            return await this.createIndex(index);
        });

        await Promise.safeAll(promises);
    }
}
