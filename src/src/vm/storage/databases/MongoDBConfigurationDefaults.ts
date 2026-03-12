import { MongoClientOptions, ReadPreference } from 'mongodb';

export const MongoDBConfigurationDefaults: MongoClientOptions = {
    readPreference: ReadPreference.PRIMARY_PREFERRED,
    directConnection: true,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 0,
    appName: `OPNet`,
};
