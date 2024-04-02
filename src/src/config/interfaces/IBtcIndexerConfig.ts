import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';
import { IConfig } from '@btc-vision/motoswapcommon';

export interface IndexerConfig {
    ENABLED: boolean;

    STORAGE_TYPE: IndexerStorageType;
}

export interface IBtcIndexerConfig extends IConfig {
    INDEXER: IndexerConfig;
}
