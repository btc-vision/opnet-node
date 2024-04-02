import { ConfigBase, ConfigManager, IConfig } from '@btc-vision/motoswapcommon';
import { IndexerStorageType } from '../vm/storage/types/IndexerStorageType.js';
import '../utils/Globals.js';
import { IBtcIndexerConfig } from './interfaces/IBtcIndexerConfig.js';
import { BtcIndexerConfig } from './BtcIndexerConfig.js';

type test = IConfig & IBtcIndexerConfig;
export class BtcIndexerConfigManager extends ConfigManager<IBtcIndexerConfig> {
    private defaultConfig: Partial<IBtcIndexerConfig> = {
        INDEXER: {
            ENABLED: false,
            STORAGE_TYPE: IndexerStorageType.MONGODB
        }
    };

    constructor(fullFileName: string) {
        super(fullFileName);
    }

    public override getConfigs(): ConfigBase {
        return new BtcIndexerConfig(this.config);
    }

    protected override getDefaultConfig(): IConfig {
        const config: test = {
            ...super.getDefaultConfig(),
            ...this.defaultConfig
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
    }

    protected override parsePartialConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        this.verifyConfig(parsedConfig);
        super.parsePartialConfig(parsedConfig);


    }
}
