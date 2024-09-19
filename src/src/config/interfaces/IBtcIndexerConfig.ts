import { IConfig, IConfigTemplate } from '@btc-vision/bsi-common';
import { IndexerStorageType } from '../../vm/storage/types/IndexerStorageType.js';
import { ChainIds } from '../enums/ChainIds.js';
import { OPNetIndexerMode } from './OPNetIndexerMode.js';
import { PeerToPeerMethod } from './PeerToPeerMethod.js';
import { BlockUpdateMethods } from '../../vm/storage/types/BlockUpdateMethods.js';

import { BitcoinNetwork } from '../network/BitcoinNetwork.js';

export interface IndexerConfig {
    readonly ENABLED: boolean;

    readonly BLOCK_UPDATE_METHOD: BlockUpdateMethods;
    readonly ALLOW_PURGE: boolean;

    readonly BLOCK_QUERY_INTERVAL: number;

    readonly STORAGE_TYPE: IndexerStorageType;
    readonly READONLY_MODE: boolean;

    readonly DISABLE_UTXO_INDEXING: boolean;
    readonly PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS: number;
}

export interface RPCConfig {
    readonly THREADS: number;
}

export interface OPNetConfig {
    readonly TRANSACTIONS_MAXIMUM_CONCURRENT: number;
    readonly PENDING_BLOCK_THRESHOLD: number;
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

export interface DevConfig {
    readonly PROCESS_ONLY_ONE_BLOCK: boolean;
    readonly DEBUG_TRANSACTION_FAILURE: boolean;
    readonly DEBUG_TRANSACTION_PARSE_FAILURE: boolean;
    readonly CAUSE_FETCHING_FAILURE: boolean;
    readonly DISPLAY_VALID_BLOCK_WITNESS: boolean;
}

export interface Bech32Config {
    readonly HRP?: string;
}

export interface Base58Config {
    PUBKEY_ADDRESS?: number;
    SCRIPT_ADDRESS?: number;
    SECRET_KEY?: number;

    EXT_PUBLIC_KEY?: number;
    EXT_SECRET_KEY?: number;
}

export interface BitcoinConfig {
    readonly CHAIN_ID: ChainIds;
    readonly NETWORK: BitcoinNetwork;
    readonly NETWORK_MAGIC?: number[];
    readonly DNS_SEEDS?: string[];
}

export interface DocsConfig {
    ENABLED: boolean;
    PORT: number;
}

export interface APIConfig {
    ENABLED: boolean;
    PORT: number;
    THREADS: number;
}

export interface BlockchainConfig {
    BITCOIND_HOST: string;
    BITCOIND_PORT: number;

    BITCOIND_USERNAME: string;
    BITCOIND_PASSWORD: string;
}

export interface IBtcIndexerConfig extends IConfig<IConfigTemplate> {
    DEV_MODE: boolean;

    DEV: DevConfig;

    BITCOIN: BitcoinConfig;
    BECH32: Bech32Config;
    BASE58: Base58Config;

    INDEXER: IndexerConfig;
    RPC: RPCConfig;
    OP_NET: OPNetConfig;
    BLOCKCHAIN: BlockchainConfig;

    DOCS: DocsConfig;

    POA: PoA;
    P2P: P2P;
    MEMPOOL: MempoolConfig;

    SSH: SSHConfig;
    API: APIExtendedConfigurations;
}
