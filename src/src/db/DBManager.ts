import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';
import { MongoDBConfigurationDefaults } from '../vm/storage/databases/MongoDBConfigurationDefaults.js';

export const DBManagerInstance: ConfigurableDBManager = new ConfigurableDBManager(
    Config,
    MongoDBConfigurationDefaults,
);
