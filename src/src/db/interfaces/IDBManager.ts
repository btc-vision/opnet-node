import { Logger } from '../../logger/Logger.js';
import { MONGO_CONNECTION_TYPE } from '../credentials/MongoCredentials.js';

export interface IDBManager {
    connect: () => Promise<void>;
    setup: (targetDatabase: string | MONGO_CONNECTION_TYPE) => Promise<boolean>;
}

export abstract class InnerDBManager extends Logger implements IDBManager {
    public abstract connect(): Promise<void>;

    public abstract setup(targetDatabase: string | MONGO_CONNECTION_TYPE): Promise<boolean>;
}
