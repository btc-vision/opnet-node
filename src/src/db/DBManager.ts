import { AnyError, Db, MongoClient, ReadPreference } from 'mongodb';
import { Config } from '../config/Config.js';
import { Globals } from '../utils/Globals.js';

import {
    MONGO_CONNECTION_TYPE,
    MongoCredentials,
    MongoCredentialsDTO,
} from './credentials/MongoCredentials.js';
import { InnerDBManager } from './interfaces/IDBManager.js';

Globals.register();

// @ts-ignore
BigInt.prototype.toJSON = function () {
    return this.toString();
};

class ConfigurableDBManager extends InnerDBManager {
    public isConnected: boolean = false;
    public db: Db | null = null;

    private client: MongoClient | undefined;
    private mongo: MongoClient | undefined;
    private isConnecting: boolean = false;
    private databaseName: string = '';
    private isProduction: boolean = false;
    private connectionUri: string = '';

    private isSetup: boolean = false;

    private readonly mongoOpts: any = {
        readPreference: ReadPreference.PRIMARY_PREFERRED,
    };

    private connectionPromise: Promise<void> | null = null;

    constructor() {
        super();
    }

    public async setup(
        _targetDatabase: string | MONGO_CONNECTION_TYPE = Config.DATABASE.CONNECTION_TYPE,
    ): Promise<boolean> {
        if (this.isSetup) return true;
        this.isSetup = true;

        this.isProduction = process.platform === 'win32';

        const mongoProductionCredentials = new MongoCredentials(<MongoCredentialsDTO>{
            databaseName: Config.DATABASE.DATABASE_NAME,

            username: Config.DATABASE.AUTH.USERNAME,
            password: Config.DATABASE.AUTH.PASSWORD,

            host: Config.DATABASE.HOST,
            port: Config.DATABASE.PORT.toString(),

            databaseMode: MONGO_CONNECTION_TYPE.PRODUCTION,
        });

        this.connectionUri = mongoProductionCredentials.connectionUri;
        this.databaseName = mongoProductionCredentials.databaseName;

        if (!this.mongo) {
            this.mongo = new MongoClient(this.connectionUri, this.mongoOpts);
        }

        return false;
    }

    public async connect(): Promise<void> {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        if (this.isConnecting) return;
        if (!this.mongo) return;

        this.isConnecting = true;

        this.connectionPromise = new Promise(async (resolve) => {
            this.info('Initializing MongoDB Remote Connection.');
            if (!this.mongo) return this.log('Mongo client is not initialized.');

            this.isConnected = false;

            const client = await this.mongo.connect().catch((err: AnyError) => {
                this.error(`Something went wrong while connecting to mongo database: ${err}.`);

                setTimeout(async () => {
                    this.warn(`Attempting mongo auto reconnection.`);
                    await this.connect();

                    resolve();
                }, 2000);
            });

            if (!client) {
                return;
            }

            this.success('MongoDB Remote Connection Established.');

            this.client = client;
            this.isConnected = true;

            this.db = this.client.db(this.databaseName);

            resolve();
        });

        return this.connectionPromise;
    }
}

export const DBManagerInstance = new ConfigurableDBManager();
