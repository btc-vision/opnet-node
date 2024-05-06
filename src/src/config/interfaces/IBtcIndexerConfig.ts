import { BlockchainConfig, IConfig, IConfigTemplate } from '@btc-vision/bsi-common';
import { BitcoinZeroMQTopic } from '../../blockchain-indexer/zeromq/enums/BitcoinZeroMQTopic.js';
import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';
import { OPNetIndexerMode } from './OPNetIndexerMode.js';
import { PeerToPeerMethod } from './PeerToPeerMethod.js';

export interface IndexerConfig {
    readonly ENABLED: boolean;

    readonly STORAGE_TYPE: IndexerStorageType;
}

export interface ZeroMQTopicConfig {
    readonly ADDRESS: string;
    readonly PORT: string;
}

export type ZeroMQConfig = Partial<Record<BitcoinZeroMQTopic, Readonly<ZeroMQTopicConfig>>>;

export interface RPCConfig {
    readonly THREADS: number;
}

export interface OPNetConfig {
    readonly TRANSACTIONS_MAXIMUM_CONCURRENT: number;
    readonly MAXIMUM_TRANSACTION_SESSIONS: number;
    readonly MAXIMUM_PREFETCH_BLOCKS: number;

    readonly ENABLED_AT_BLOCK: number;

    REINDEX: boolean;
    readonly REINDEX_FROM_BLOCK: number;

    readonly DISABLE_SCANNED_BLOCK_STORAGE_CHECK: boolean;
    readonly VERIFY_INTEGRITY_ON_STARTUP: boolean;

    readonly MODE: OPNetIndexerMode;
}

export interface PoA {
    readonly ENABLED: boolean;
}

export interface P2P {
    readonly ENABLE_IPV6: boolean;
    readonly P2P_HOST_V6: string;
    readonly P2P_PORT_V6: number;

    readonly P2P_HOST: string;
    readonly P2P_PORT: number;

    readonly P2P_PROTOCOL: PeerToPeerMethod;

    readonly MINIMUM_PEERS: number;
    readonly MAXIMUM_PEERS: number;
    readonly MAXIMUM_INCOMING_PENDING_PEERS: number;

    readonly PEER_INACTIVITY_TIMEOUT: number;

    readonly MAXIMUM_INBOUND_STREAMS: number;
    readonly MAXIMUM_OUTBOUND_STREAMS: number;

    readonly BOOTSTRAP_NODES: string[];

    readonly TRUSTED_VALIDATORS: string[];
    readonly TRUSTED_VALIDATORS_CHECKSUM_HASH: string;
}

export interface IBtcIndexerConfig extends IConfig<IConfigTemplate> {
    INDEXER: IndexerConfig;
    ZERO_MQ: ZeroMQConfig;
    RPC: RPCConfig;
    OP_NET: OPNetConfig;
    BLOCKCHAIN: BlockchainConfig;
    POA: PoA;
    P2P: P2P;
}
