import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';
import { IConfigTemplate } from '@btc-vision/motoswapcommon';

export interface IndexerConfig {
    ENABLED: boolean;

    STORAGE_TYPE: IndexerStorageType;
}

export interface IBtcIndexerConfig extends IConfigTemplate {
    INDEXER: IndexerConfig;
}
