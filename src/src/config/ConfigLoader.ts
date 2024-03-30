import fs from 'fs';
import toml from 'toml';
import { MONGO_CONNECTION_TYPE } from '../db/credentials/MongoCredentials.js';
import { DebugLevel } from '../logger/enums/DebugLevel.js';
import { Logger } from '../logger/Logger.js';
import { ConfigBase } from './ConfigBase.js';
import { IConfig } from './interfaces/IConfig.js';
import { CacheStrategy } from '../cache/enum/CacheStrategy.js'
import { BitcoinNetwork } from './enum/BitcoinNetwork.js'

export class ConfigManager extends Logger {
    public readonly logColor: string = '#c71585';

    private readonly config: IConfig = {
        DOCS: {
            ENABLED: true,
            PORT: 7000,
        },
        API: {
            ENABLED: true,
            PORT: 9001,
            THREADS: 2,
        },
        BLOCKCHAIN: {
            BITCOIND_HOST: '',
            BITCOIND_NETWORK: BitcoinNetwork.Unknown,
            BITCOIND_PORT: 0
        },
        INDEXER: {
            ENABLED: true,
        },
        DATABASE: {
            CONNECTION_TYPE: MONGO_CONNECTION_TYPE.TESTNET,

            DATABASE_NAME: '',
            HOST: '',
            PORT: 0,

            AUTH: {
                USERNAME: '',
                PASSWORD: '',
            },
        },
        ORDCLIENT: {
            ORDCLIENT_URL: ''
        },

        DEBUG_LEVEL: DebugLevel.INFO,
        CACHE_STRATEGY: CacheStrategy.NODE_CACHE,
        DEBUG_FILEPATH: './debug.log',
        LOG_FOLDER: '',
        MRC_DISTRIBUTION_PERIOD: 100,
    };

    constructor() {
        super();

        this.loadConfig();
    }

    private loadConfig(): void {
        const config: string = fs.readFileSync('./config/motoswap.conf', 'utf-8');

        if (!config) {
            throw new Error(
                'Failed to load config file. Please ensure that the config file exists.',
            );
        }

        try {
            const parsedConfig: Partial<IConfig> = toml.parse(config);

            this.parsePartialConfig(parsedConfig);
        } catch (e: unknown) {
            console.log(e);
            const error: Error = e as Error;

            this.error(`Failed to load config file. {Details: ${error.stack}}`);
        }
    }

    private verifyConfig(parsedConfig: Partial<IConfig>): void {
        // We verify the parsed config type and values.

        if (parsedConfig.DOCS) {
            if (parsedConfig.DOCS.ENABLED && typeof parsedConfig.DOCS.ENABLED !== 'boolean') {
                throw new Error(`Oops the property DOCS.ENABLED is not a boolean.`);
            }

            if (parsedConfig.DOCS.ENABLED && typeof parsedConfig.DOCS.PORT !== 'number') {
                throw new Error(`Oops the property DOCS.PORT is not a number.`);
            }
        }

        if (parsedConfig.API) {
            if (parsedConfig.API.ENABLED && typeof parsedConfig.API.ENABLED !== 'boolean') {
                throw new Error(`Oops the property API.ENABLED is not a boolean.`);
            }

            if (parsedConfig.API.ENABLED && typeof parsedConfig.API.PORT !== 'number') {
                throw new Error(`Oops the property API.PORT is not a number.`);
            }
        }

        if (parsedConfig.DATABASE) {
            if (typeof parsedConfig.DATABASE.CONNECTION_TYPE !== 'string') {
                throw new Error(`Oops the property DATABASE.CONNECTION_TYPE is not a string.`);
            }

            if (typeof parsedConfig.DATABASE.DATABASE_NAME !== 'string') {
                throw new Error(`Oops the property DATABASE.DATABASE_NAME is not a string.`);
            }

            if (typeof parsedConfig.DATABASE.HOST !== 'string') {
                throw new Error(`Oops the property DATABASE.HOST is not a string.`);
            }

            if (typeof parsedConfig.DATABASE.PORT !== 'number') {
                throw new Error(`Oops the property DATABASE.PORT is not a number.`);
            }

            if (parsedConfig.DATABASE.AUTH) {
                if (typeof parsedConfig.DATABASE.AUTH.USERNAME !== 'string') {
                    throw new Error(`Oops the property DATABASE.AUTH.USERNAME is not a string.`);
                }

                if (typeof parsedConfig.DATABASE.AUTH.PASSWORD !== 'string') {
                    throw new Error(`Oops the property DATABASE.AUTH.PASSWORD is not a string.`);
                }
            }
        }

        if (parsedConfig.INDEXER) {
            if (parsedConfig.INDEXER.ENABLED && typeof parsedConfig.INDEXER.ENABLED !== 'boolean') {
                throw new Error(`Oops the property INDEXER.ENABLED is not a boolean.`);
            }
        }

        if (parsedConfig.BLOCKCHAIN) {
            if (typeof parsedConfig.BLOCKCHAIN.BITCOIND_HOST !== 'string') {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_HOST is not a string.`);
            }

            if (!parsedConfig.BLOCKCHAIN.BITCOIND_HOST) {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_HOST is not valid.`);
            }

            if (typeof parsedConfig.BLOCKCHAIN.BITCOIND_NETWORK !== 'number') {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_NETWORK is not a valid BitcoinNetwork enum value.`);
            }

            if (parsedConfig.BLOCKCHAIN.BITCOIND_NETWORK !== BitcoinNetwork.Mainnet &&
                parsedConfig.BLOCKCHAIN.BITCOIND_NETWORK !== BitcoinNetwork.TestNet) {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_NETWORK is not a valid BitcoinNetwork enum value.`);
            }

            if (typeof parsedConfig.BLOCKCHAIN.BITCOIND_PORT !== 'number') {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_PORT is not a number.`);
            }

            if (parsedConfig.BLOCKCHAIN.BITCOIND_PORT === 0) {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_PORT is not defined.`);
            }
        }

        if (parsedConfig.DEBUG_LEVEL) {
            if (typeof parsedConfig.DEBUG_LEVEL !== 'number') {
                throw new Error(`Oops the property DEBUG_LEVEL is not a number.`);
            }
        }

        if (parsedConfig.CACHE_STRATEGY) {
            if (typeof parsedConfig.CACHE_STRATEGY !== 'number') {
                throw new Error(`Oops the property CACHE_STRATEGY is not a valid CacheStrategy enum value.`);
            }

            if (parsedConfig.CACHE_STRATEGY !== CacheStrategy.NODE_CACHE) {
                throw new Error(`Oops the property CACHE_STRATEGY is not a valid CacheStrategy enum value.`);
            }
        }

        if (parsedConfig.DEBUG_FILEPATH) {
            if (typeof parsedConfig.DEBUG_FILEPATH !== 'string') {
                throw new Error(`Oops the property DEBUG_FILEPATH is not a string.`);
            }
        }

        if (parsedConfig.LOG_FOLDER) {
            if (typeof parsedConfig.LOG_FOLDER !== 'string') {
                throw new Error(`Oops the property LOG_FOLDER is not a string.`);
            }
        }

        if (parsedConfig.MRC_DISTRIBUTION_PERIOD) {
            if (typeof parsedConfig.MRC_DISTRIBUTION_PERIOD !== 'number') {
                throw new Error(`Oops the property MRC_DISTRIBUTION_PERIOD is not a number.`);
            }

            if (parsedConfig.MRC_DISTRIBUTION_PERIOD <= 0) {
                throw new Error(`Oops the property MRC_DISTRIBUTION_PERIOD must be > 0.`);
            }
        }

        if (parsedConfig.ORDCLIENT) {
            if (typeof parsedConfig.ORDCLIENT.ORDCLIENT_URL !== 'string') {
                throw new Error(`Oops the property ORDCLIENT.ORDCLIENT_URL is not a string.`);
            }

            if (!parsedConfig.ORDCLIENT.ORDCLIENT_URL) {
                throw new Error(`Oops the property ORDCLIENT.ORDCLIENT_URL is not valid.`);
            }
        }
    }

    private parsePartialConfig(parsedConfig: Partial<IConfig>): void {
        this.verifyConfig(parsedConfig);

        // We merge the parsed config with the default config and their sub objects.
        this.config.DOCS = {
            ...this.config.DOCS,
            ...parsedConfig.DOCS,
        };

        this.config.API = {
            ...this.config.API,
            ...parsedConfig.API,
        };

        this.config.BLOCKCHAIN = {
            ...this.config.BLOCKCHAIN,
            ...parsedConfig.BLOCKCHAIN,
        };

        this.config.INDEXER = {
            ...this.config.INDEXER,
            ...parsedConfig.INDEXER,
        };

        this.config.DATABASE = {
            ...this.config.DATABASE,
            ...parsedConfig.DATABASE,
        };

        this.config.ORDCLIENT= {
            ...this.config.ORDCLIENT,
            ...parsedConfig.ORDCLIENT,
        };

        this.config.DEBUG_LEVEL = parsedConfig.DEBUG_LEVEL || this.config.DEBUG_LEVEL;
        this.config.CACHE_STRATEGY = parsedConfig.CACHE_STRATEGY || this.config.CACHE_STRATEGY;
        this.config.DEBUG_FILEPATH = parsedConfig.DEBUG_FILEPATH || this.config.DEBUG_FILEPATH;
        this.config.LOG_FOLDER = parsedConfig.LOG_FOLDER || this.config.LOG_FOLDER;
        this.config.MRC_DISTRIBUTION_PERIOD = parsedConfig.MRC_DISTRIBUTION_PERIOD || this.config.MRC_DISTRIBUTION_PERIOD;
    }

    public getConfigs(): IConfig {
        return new ConfigBase(this.config);
    }
}
