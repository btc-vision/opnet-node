import { APIConfig, BlockchainConfig, IConfig, IConfigTemplate } from '@btc-vision/bsi-common';
import { BitcoinZeroMQTopic } from '../../blockchain-indexer/zeromq/enums/BitcoinZeroMQTopic.js';
import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';
import { ChainIds } from '../enums/ChainIds.js';
import { OPNetIndexerMode } from './OPNetIndexerMode.js';
import { PeerToPeerMethod } from './PeerToPeerMethod.js';

export interface IndexerConfig {
    readonly ENABLED: boolean;

    readonly ALLOW_PURGE: boolean;

    readonly STORAGE_TYPE: IndexerStorageType;
    readonly READONLY_MODE: boolean;
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

    readonly CHAIN_ID: ChainIds;
    readonly MODE: OPNetIndexerMode;
}

export interface PoA {
    readonly ENABLED: boolean;
}

export interface P2P {
    readonly IS_BOOTSTRAP_NODE: boolean;
    readonly CLIENT_MODE: boolean;

    readonly MDNS: boolean;

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

export interface MempoolConfig {
    readonly THREADS: number;

    readonly EXPIRATION_BLOCKS: number;
    readonly ENABLE_BLOCK_PURGE: boolean;
}

export interface SSHConfig {
    readonly ENABLED: boolean;

    readonly PORT: number;
    readonly HOST: string;

    readonly USERNAME: string;
    readonly PASSWORD: string;

    readonly PUBLIC_KEY: string;

    readonly NO_AUTH: boolean;

    readonly ALLOWED_IPS: string[];
}

export interface APIExtendedConfigurations extends APIConfig {
    readonly MAXIMUM_PENDING_REQUESTS_PER_THREADS: number; // Maximum number of pending requests per thread
    readonly BATCH_PROCESSING_SIZE: number; // Batch processing size

    readonly MAXIMUM_PARALLEL_BLOCK_QUERY: number; // Maximum number of blocks per batch
    readonly MAXIMUM_REQUESTS_PER_BATCH: number; // Maximum number of requests per batch

    readonly MAXIMUM_TRANSACTION_BROADCAST: number; // Maximum number of transactions to broadcast
    readonly MAXIMUM_PENDING_CALL_REQUESTS: number; // Maximum number of pending call requests
}

export interface IBtcIndexerConfig extends IConfig<IConfigTemplate> {
    INDEXER: IndexerConfig;
    ZERO_MQ: ZeroMQConfig;
    RPC: RPCConfig;
    OP_NET: OPNetConfig;
    BLOCKCHAIN: BlockchainConfig;
    POA: PoA;
    P2P: P2P;
    MEMPOOL: MempoolConfig;
    SSH: SSHConfig;
    API: APIExtendedConfigurations;
}
