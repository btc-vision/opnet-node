import { ConfigManager, IConfig } from '@btc-vision/bsi-common';
import { BitcoinZeroMQTopic } from '../blockchain-indexer/zeromq/enums/BitcoinZeroMQTopic.js';
import { IndexerStorageType } from '../vm/storage/types/IndexerStorageType.js';
import { BtcIndexerConfig } from './BtcIndexerConfig.js';
import { IBtcIndexerConfig } from './interfaces/IBtcIndexerConfig.js';

export class BtcIndexerConfigManager extends ConfigManager<IConfig<IBtcIndexerConfig>> {
    private defaultConfig: Partial<IBtcIndexerConfig> = {
        INDEXER: {
            ENABLED: false,
            STORAGE_TYPE: IndexerStorageType.MONGODB,
        },

        ZERO_MQ: {},
    };

    constructor(fullFileName: string) {
        super(fullFileName);
    }

    public override getConfigs(): BtcIndexerConfig {
        return new BtcIndexerConfig(this.config);
    }

    protected getDefaultConfig(): IConfig<IBtcIndexerConfig> {
        const config: IConfig<IBtcIndexerConfig> = {
            ...super.getDefaultConfig(),
            ...this.defaultConfig,
        };

        return config;
    }

    protected override verifyConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        super.verifyConfig(parsedConfig);

        if (parsedConfig.INDEXER) {
            if (parsedConfig.INDEXER.ENABLED && typeof parsedConfig.INDEXER.ENABLED !== 'boolean') {
                throw new Error(`Oops the property INDEXER.ENABLED is not a boolean.`);
            }

            if (
                typeof parsedConfig.INDEXER.STORAGE_TYPE !== 'string' ||
                IndexerStorageType[parsedConfig.INDEXER.STORAGE_TYPE] === undefined
            ) {
                throw new Error(
                    `Oops the property INDEXER.STORAGE_TYPE is not a valid IndexerStorageType enum value.`,
                );
            }
        }

        if (parsedConfig.ZERO_MQ) {
            for (const topic in parsedConfig.ZERO_MQ) {
                const subTopic = topic as BitcoinZeroMQTopic;
                const zeroMQConfig = parsedConfig.ZERO_MQ[subTopic];

                if (typeof zeroMQConfig !== 'object') {
                    throw new Error(`Oops the property ZERO_MQ.${topic} is not an object.`);
                }

                if (!zeroMQConfig.ADDRESS || typeof zeroMQConfig.ADDRESS !== 'string') {
                    throw new Error(`Oops the property ZERO_MQ.${topic}.ADDRESS is not a string.`);
                }

                if (!zeroMQConfig.PORT || typeof zeroMQConfig.PORT !== 'number') {
                    throw new Error(`Oops the property ZERO_MQ.${topic}.PORT is not a string.`);
                }
            }
        }

        if (parsedConfig.RPC) {
            if (
                parsedConfig.RPC.THREADS === undefined ||
                typeof parsedConfig.RPC.THREADS !== 'number'
            ) {
                throw new Error(`Oops the property RPC.ENABLED is not a boolean.`);
            }
        }

        if(parsedConfig.OP_NET) {
            if(parsedConfig.OP_NET.ENABLED_AT_BLOCK === undefined || typeof parsedConfig.OP_NET.ENABLED_AT_BLOCK !== 'number') {
                throw new Error(`Oops the property OP_NET.ENABLED_AT_BLOCK is not a number.`);
            }
        }
    }

    protected override parsePartialConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        this.verifyConfig(parsedConfig);
        super.parsePartialConfig(parsedConfig);

        this.config.INDEXER = {
            ...parsedConfig.INDEXER,
            ...this.config.INDEXER,
        };

        this.config.ZERO_MQ = {
            ...parsedConfig.ZERO_MQ,
            ...this.config.ZERO_MQ,
        };

        this.config.RPC = {
            ...parsedConfig.RPC,
            ...this.config.RPC,
        };

        this.config.BLOCKCHAIN = {
            ...parsedConfig.BLOCKCHAIN,
            ...this.config.BLOCKCHAIN,
        };

        this.config.OP_NET = {
            ...parsedConfig.OP_NET,
            ...this.config.OP_NET,
        }
    }
}
