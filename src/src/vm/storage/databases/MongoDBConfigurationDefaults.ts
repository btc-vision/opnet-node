import { MongoClientOptions, ReadPreference } from 'mongodb';
import { Config } from '../../../config/Config.js';

console.log('Config.DATABASE.AUTH_SOURCE', Config.DATABASE_AUTH);

export const MongoDBConfigurationDefaults: MongoClientOptions = {
    readPreference: ReadPreference.PRIMARY_PREFERRED,
    directConnection: true,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 0,
    appName: `OPNet`,
    authSource: Config.DATABASE_AUTH.SOURCE,
};
