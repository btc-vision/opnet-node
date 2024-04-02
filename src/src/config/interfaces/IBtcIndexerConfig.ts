import { IConfig, IConfigTemplate } from '@btc-vision/motoswapcommon';
import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';

export interface IndexerConfig {
    ENABLED: boolean;

    STORAGE_TYPE: IndexerStorageType;
}

export interface IBtcIndexerConfig extends IConfig<IConfigTemplate> {
    INDEXER: IndexerConfig;
}
