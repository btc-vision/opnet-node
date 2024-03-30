import { Collection, Db, Document } from 'mongodb';
import { Logger } from '../../logger/Logger.js';
import { DBManagerInstance } from '../DBManager.js';

export abstract class Repository extends Logger {
    protected constructor() {
        super();
    }

    protected get db(): Db {
        if (!DBManagerInstance.db) throw new Error('Database is not connected.');

        return DBManagerInstance.db;
    }

    protected getCollection<T extends Document>(collectionName: string): Collection<T> {
        return this.db.collection(collectionName);
    }
}
