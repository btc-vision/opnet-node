import { MongoClientOptions, ReadPreference } from 'mongodb';
import { Config } from '../../../config/Config.js';

export const MongoDBConfigurationDefaults: MongoClientOptions = {
    readPreference: ReadPreference.PRIMARY_PREFERRED,
    directConnection: true,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 0,
    appName: `OPNet`,
    authSource: Config.DATABASE_AUTH.SOURCE,
};
