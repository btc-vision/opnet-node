import { BlockchainConfig, IConfig, IConfigTemplate } from '@btc-vision/bsi-common';
import { BitcoinZeroMQTopic } from '../../blockchain-indexer/zeromq/enums/BitcoinZeroMQTopic.js';
import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';

export interface IndexerConfig {
    ENABLED: boolean;

    STORAGE_TYPE: IndexerStorageType;
}

export interface ZeroMQTopicConfig {
    ADDRESS: string;
    PORT: string;
}

export type ZeroMQConfig = Partial<Record<BitcoinZeroMQTopic, Readonly<ZeroMQTopicConfig>>>;

export interface RPCConfig {
    THREADS: number;
}

export interface IBtcIndexerConfig extends IConfig<IConfigTemplate> {
    INDEXER: IndexerConfig;
    ZERO_MQ: ZeroMQConfig;
    RPC: RPCConfig;
    BLOCKCHAIN: BlockchainConfig;
}
