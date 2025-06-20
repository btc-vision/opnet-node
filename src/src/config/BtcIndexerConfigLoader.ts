import { ConfigManager, IConfig } from '@btc-vision/bsi-common';
import { IndexerStorageType } from '../vm/storage/types/IndexerStorageType.js';
import { BtcIndexerConfig } from './BtcIndexerConfig.js';
import { ChainIds } from './enums/ChainIds.js';
import { IBtcIndexerConfig } from './interfaces/IBtcIndexerConfig.js';
import { OPNetIndexerMode } from './interfaces/OPNetIndexerMode.js';
import { PeerToPeerMethod } from './interfaces/PeerToPeerMethod.js';
import { BlockUpdateMethods } from '../vm/storage/types/BlockUpdateMethods.js';
import { BitcoinNetwork } from './network/BitcoinNetwork.js';

export class BtcIndexerConfigManager extends ConfigManager<IConfig<IBtcIndexerConfig>> {
    private defaultConfig: Partial<IBtcIndexerConfig> = {
        DOCS: {
            ENABLED: true,
            PORT: 7000,
        },

        BITCOIN: {
            CHAIN_ID: ChainIds.Bitcoin,
            NETWORK: BitcoinNetwork.mainnet,
            NETWORK_MAGIC: [],
            DNS_SEEDS: [],
        },

        BLOCKCHAIN: {
            BITCOIND_HOST: '',
            BITCOIND_PORT: 0,
            BITCOIND_USERNAME: '',
            BITCOIND_PASSWORD: '',
        },

        DATABASE: {
            DATABASE_NAME: '',
            HOST: '',
            PORT: 0,

            AUTH: {
                USERNAME: '',
                PASSWORD: '',
            },
        },

        DEV_MODE: false,
        INDEXER: {
            ENABLED: false,
            BLOCK_UPDATE_METHOD: BlockUpdateMethods.RPC,
            STORAGE_TYPE: IndexerStorageType.MONGODB,
            ALLOW_PURGE: true,
            BLOCK_QUERY_INTERVAL: 5000,
            READONLY_MODE: false,
            SOLVE_UNKNOWN_UTXOS: false,

            /** UTXOs */
            DISABLE_UTXO_INDEXING: false,
            PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS: 1000,
            UTXO_SAVE_INTERVAL: 30000,
        },

        DEV: {
            PROCESS_ONLY_X_BLOCK: 0,
            DEBUG_TRANSACTION_FAILURE: false,
            DEBUG_TRANSACTION_PARSE_FAILURE: false,
            CAUSE_FETCHING_FAILURE: false,
            DISPLAY_VALID_BLOCK_WITNESS: false,
            DISPLAY_INVALID_BLOCK_WITNESS: true,
            SAVE_TIMEOUTS_TO_FILE: false,
            SIMULATE_HIGH_GAS_USAGE: false,
            DEBUG_VALID_TRANSACTIONS: false,
            DEBUG_API_ERRORS: false,
            ENABLE_CONTRACT_DEBUG: false,
            ALWAYS_ENABLE_REORG_VERIFICATION: false,
            ENABLE_REORG_NIGHTMARE: false,
        },

        BASE58: {},

        BECH32: {},

        P2P: {
            IS_BOOTSTRAP_NODE: false,
            CLIENT_MODE: false,
            ENABLE_IPV6: false,

            ENABLE_IP_BANNING: false,
            MDNS: false,

            P2P_HOST_V6: '::',
            P2P_PORT_V6: 9801,

            P2P_HOST: '0.0.0.0',
            P2P_PORT: 9800,
            P2P_PROTOCOL: PeerToPeerMethod.TCP,

            ENABLE_P2P_LOGGING: false,

            MINIMUM_PEERS: 50,
            MAXIMUM_PEERS: 100,
            MAXIMUM_INCOMING_PENDING_PEERS: 50,

            PEER_INACTIVITY_TIMEOUT: 60000,

            MAXIMUM_INBOUND_STREAMS: 100,
            MAXIMUM_OUTBOUND_STREAMS: 100,

            BOOTSTRAP_NODES: [],
            TRUSTED_VALIDATORS: [],
            TRUSTED_VALIDATORS_CHECKSUM_HASH: '',
        },

        API: {
            ENABLED: true,
            PORT: 9001,

            THREADS: 2,
            MAXIMUM_PENDING_REQUESTS_PER_THREADS: 100,

            BATCH_PROCESSING_SIZE: 15,
            MAXIMUM_PARALLEL_BLOCK_QUERY: 50, // on mainnet, 50 blocks can load a lot of data in memory.
            MAXIMUM_REQUESTS_PER_BATCH: 500,

            MAXIMUM_TRANSACTION_BROADCAST: 50,
            MAXIMUM_PENDING_CALL_REQUESTS: 100,

            UTXO_LIMIT: 500,
        },

        POC: {
            ENABLED: false,
        },

        MEMPOOL: {
            THREADS: 2,
            PREVENT_TX_BROADCAST_IF_NOT_SYNCED: true,
            EXPIRATION_BLOCKS: 20,
            ENABLE_BLOCK_PURGE: true,
            BATCH_SIZE: 25,
            FETCH_INTERVAL: 30000,
        },

        RPC: {
            CHILD_PROCESSES: 2,
            THREADS: 2,
            VM_CONCURRENCY: 1,
        },

        SSH: {
            ENABLED: false,

            PORT: 4800,
            HOST: '0.0.0.0',

            NO_AUTH: false,

            USERNAME: 'opnet',
            PASSWORD: 'opnet',

            PUBLIC_KEY: '',
            ALLOWED_IPS: ['127.0.0.1', '0.0.0.0', 'localhost'],
        },

        OP_NET: {
            PENDING_BLOCK_THRESHOLD: 12,
            TRANSACTIONS_MAXIMUM_CONCURRENT: 100,
            MAXIMUM_PREFETCH_BLOCKS: 10,

            REINDEX: false,
            REINDEX_FROM_BLOCK: 0,
            ENABLE_BATCH_PROCESSING: true,

            VERIFY_INTEGRITY_ON_STARTUP: false,
            DISABLE_SCANNED_BLOCK_STORAGE_CHECK: true,

            MODE: OPNetIndexerMode.ARCHIVE,

            /* LIGHT MODE */
            LIGHT_MODE_FROM_BLOCK: 10000,
        },
    };
    private verifiedConfig: boolean = false;

    constructor(fullFileName: string) {
        super(fullFileName, false);

        this.loadConfig(fullFileName);
    }

    public override getConfigs(): BtcIndexerConfig {
        return new BtcIndexerConfig(this.config);
    }

    protected getDefaultConfig(): IConfig<IBtcIndexerConfig> {
        return {
            ...super.getDefaultConfig(),
            ...this.defaultConfig,
        };
    }

    protected override verifyConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        if (this.verifiedConfig) {
            throw new Error('Config has already been verified.');
        }

        super.verifyConfig(parsedConfig);

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

        if (parsedConfig.BLOCKCHAIN) {
            if (typeof parsedConfig.BLOCKCHAIN.BITCOIND_HOST !== 'string') {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_HOST is not a string.`);
            }

            if (!parsedConfig.BLOCKCHAIN.BITCOIND_HOST) {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_HOST is not valid.`);
            }

            if (typeof parsedConfig.BLOCKCHAIN.BITCOIND_PORT !== 'number') {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_PORT is not a number.`);
            }

            if (parsedConfig.BLOCKCHAIN.BITCOIND_PORT === 0) {
                throw new Error(`Oops the property BLOCKCHAIN.BITCOIND_PORT is not defined.`);
            }
        }

        if (parsedConfig.DEV_MODE != null && typeof parsedConfig.DEV_MODE !== 'boolean') {
            throw new Error(`Oops the property DEV_MODE is not a boolean.`);
        }

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

            if (
                typeof parsedConfig.INDEXER.BLOCK_UPDATE_METHOD !== 'string' ||
                BlockUpdateMethods[parsedConfig.INDEXER.BLOCK_UPDATE_METHOD] === undefined
            ) {
                throw new Error(
                    `Oops the property INDEXER.BLOCK_UPDATE_METHOD is not a valid BlockUpdateMethods enum value.`,
                );
            }

            if (
                parsedConfig.INDEXER.ALLOW_PURGE !== undefined &&
                typeof parsedConfig.INDEXER.ALLOW_PURGE !== 'boolean'
            ) {
                throw new Error(`Oops the property INDEXER.ALLOW_PURGE is not a boolean.`);
            }

            if (
                typeof parsedConfig.INDEXER.READONLY_MODE !== 'boolean' &&
                parsedConfig.INDEXER.READONLY_MODE !== undefined
            ) {
                throw new Error(`Oops the property INDEXER.READONLY_MODE is not a boolean.`);
            }

            if (
                parsedConfig.INDEXER.DISABLE_UTXO_INDEXING !== undefined &&
                typeof parsedConfig.INDEXER.DISABLE_UTXO_INDEXING !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property INDEXER.DISABLE_UTXO_INDEXING is not a boolean.`,
                );
            }

            if (
                parsedConfig.INDEXER.PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS !== undefined &&
                typeof parsedConfig.INDEXER.PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS !== 'number'
            ) {
                throw new Error(
                    `Oops the property INDEXER.PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS is not a number.`,
                );
            }

            if (
                parsedConfig.INDEXER.UTXO_SAVE_INTERVAL !== undefined &&
                typeof parsedConfig.INDEXER.UTXO_SAVE_INTERVAL !== 'number'
            ) {
                throw new Error(`Oops the property INDEXER.UTXO_SAVE_INTERVAL is not a number.`);
            }

            if (
                parsedConfig.INDEXER.BLOCK_QUERY_INTERVAL !== undefined &&
                typeof parsedConfig.INDEXER.BLOCK_QUERY_INTERVAL !== 'number'
            ) {
                throw new Error(`Oops the property INDEXER.BLOCK_QUERY_INTERVAL is not a number.`);
            }

            if (
                parsedConfig.INDEXER.SOLVE_UNKNOWN_UTXOS !== undefined &&
                typeof parsedConfig.INDEXER.SOLVE_UNKNOWN_UTXOS !== 'boolean'
            ) {
                throw new Error(`Oops the property INDEXER.SOLVE_UNKNOWN_UTXOS is not a boolean.`);
            }
        }

        if (parsedConfig.RPC) {
            if (
                parsedConfig.RPC.THREADS !== undefined &&
                typeof parsedConfig.RPC.THREADS !== 'number'
            ) {
                throw new Error(`Oops the property RPC.THREADS is not a boolean.`);
            }

            if (
                parsedConfig.RPC.VM_CONCURRENCY !== undefined &&
                typeof parsedConfig.RPC.VM_CONCURRENCY !== 'number'
            ) {
                throw new Error(`Oops the property RPC.VM_CONCURRENCY is not a number.`);
            }

            if (
                parsedConfig.RPC.CHILD_PROCESSES !== undefined &&
                typeof parsedConfig.RPC.CHILD_PROCESSES !== 'number'
            ) {
                throw new Error(`Oops the property RPC.CHILD_PROCESSES is not a number.`);
            }
        }

        if (parsedConfig.OP_NET) {
            if (
                parsedConfig.OP_NET.MAXIMUM_PREFETCH_BLOCKS !== undefined &&
                typeof parsedConfig.OP_NET.MAXIMUM_PREFETCH_BLOCKS !== 'number'
            ) {
                throw new Error(
                    `Oops the property OP_NET.MAXIMUM_PREFETCH_BLOCKS is not a number.`,
                );
            }

            if (
                parsedConfig.OP_NET.REINDEX === undefined ||
                typeof parsedConfig.OP_NET.REINDEX !== 'boolean'
            ) {
                throw new Error(`Oops the property OP_NET.REINDEX is not a boolean.`);
            }

            if (
                parsedConfig.OP_NET.ENABLE_BATCH_PROCESSING !== undefined &&
                typeof parsedConfig.OP_NET.ENABLE_BATCH_PROCESSING !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property OP_NET.ENABLE_BATCH_PROCESSING is not a boolean.`,
                );
            }

            if (
                parsedConfig.OP_NET.REINDEX_FROM_BLOCK !== undefined &&
                typeof parsedConfig.OP_NET.REINDEX_FROM_BLOCK !== 'number'
            ) {
                throw new Error(`Oops the property OP_NET.REINDEX_FROM_BLOCK is not a number.`);
            }

            if (
                parsedConfig.OP_NET.VERIFY_INTEGRITY_ON_STARTUP === undefined ||
                typeof parsedConfig.OP_NET.VERIFY_INTEGRITY_ON_STARTUP !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property OP_NET.VERIFY_INTEGRITY_ON_STARTUP is not a boolean.`,
                );
            }

            if (
                parsedConfig.OP_NET.MODE === undefined ||
                typeof parsedConfig.OP_NET.MODE !== 'string'
            ) {
                throw new Error(`Oops the property OP_NET.MODE is not a string.`);
            }

            if (
                parsedConfig.OP_NET.LIGHT_MODE_FROM_BLOCK !== undefined &&
                typeof parsedConfig.OP_NET.LIGHT_MODE_FROM_BLOCK !== 'number'
            ) {
                throw new Error(`Oops the property OP_NET.LIGHT_MODE_FROM_BLOCK is not a number.`);
            }

            if (!(parsedConfig.OP_NET.MODE in OPNetIndexerMode)) {
                throw new Error(
                    `Oops the property OP_NET.MODE is not a valid OPNetIndexerMode enum value.`,
                );
            }

            if (
                parsedConfig.OP_NET.PENDING_BLOCK_THRESHOLD !== undefined &&
                typeof parsedConfig.OP_NET.PENDING_BLOCK_THRESHOLD !== 'number'
            ) {
                throw new Error(`Oops the property OP_NET.TRANSACTIONS_THREADS is not a number.`);
            }

            if (
                parsedConfig.OP_NET.TRANSACTIONS_MAXIMUM_CONCURRENT !== undefined &&
                typeof parsedConfig.OP_NET.TRANSACTIONS_MAXIMUM_CONCURRENT !== 'number'
            ) {
                throw new Error(
                    `Oops the property OP_NET.TRANSACTIONS_MAXIMUM_CONCURRENT is not a number.`,
                );
            }
        }

        if (parsedConfig.BITCOIN) {
            if (
                parsedConfig.BITCOIN.CHAIN_ID !== undefined &&
                typeof parsedConfig.BITCOIN.CHAIN_ID !== 'number'
            ) {
                throw new Error(`Oops the property OP_NET.CHAIN_ID is not a number.`);
            }

            // Prohibit the use of the main chain id.
            /*if (
                parsedConfig.BITCOIN.NETWORK === BitcoinNetwork.mainnet &&
                parsedConfig.BITCOIN.CHAIN_ID === ChainIds.Bitcoin
            ) {
                throw new Error(
                    `Mainnet configuration is not allowed. Please use the testnet configuration.`,
                );
            }*/

            if (
                parsedConfig.BITCOIN.NETWORK_MAGIC !== undefined &&
                !Array.isArray(parsedConfig.BITCOIN.NETWORK_MAGIC)
            ) {
                throw new Error(`Oops the property BITCOIN.NETWORK_MAGIC is not an array.`);
            } else if (parsedConfig.BITCOIN.NETWORK_MAGIC) {
                for (const magic of parsedConfig.BITCOIN.NETWORK_MAGIC) {
                    if (typeof magic !== 'number') {
                        throw new Error(
                            `Oops the property BITCOIN.NETWORK_MAGIC is not an array of numbers.`,
                        );
                    }
                }
            }

            if (
                parsedConfig.BITCOIN.NETWORK !== undefined &&
                !(parsedConfig.BITCOIN.NETWORK in BitcoinNetwork)
            ) {
                throw new Error(
                    `Oops the property BITCOIN.NETWORK is not a valid BitcoinNetwork enum value.`,
                );
            }

            if (
                parsedConfig.BITCOIN.DNS_SEEDS !== undefined &&
                !Array.isArray(parsedConfig.BITCOIN.DNS_SEEDS)
            ) {
                throw new Error(`Oops the property OP_NET.DNS_SEEDS is not an array.`);
            }
        }

        if (parsedConfig.POC) {
            if (
                parsedConfig.POC.ENABLED !== undefined &&
                typeof parsedConfig.POC.ENABLED !== 'boolean'
            ) {
                throw new Error(`Oops the property POA.ENABLED is not a boolean.`);
            }
        }

        if (parsedConfig.P2P) {
            if (
                parsedConfig.P2P.CLIENT_MODE !== undefined &&
                typeof parsedConfig.P2P.CLIENT_MODE !== 'boolean'
            ) {
                throw new Error(`Oops the property P2P.CLIENT_MODE is not a boolean.`);
            }

            if (parsedConfig.P2P.MDNS !== undefined && typeof parsedConfig.P2P.MDNS !== 'boolean') {
                throw new Error(`Oops the property P2P.MDNS is not a boolean.`);
            }

            if (
                parsedConfig.P2P.ENABLE_IP_BANNING !== undefined &&
                typeof parsedConfig.P2P.ENABLE_IP_BANNING !== 'boolean'
            ) {
                throw new Error(`Oops the property P2P.ENABLE_IP_BANNING is not a boolean.`);
            }

            if (
                parsedConfig.P2P.IS_BOOTSTRAP_NODE !== undefined &&
                typeof parsedConfig.P2P.IS_BOOTSTRAP_NODE !== 'boolean'
            ) {
                throw new Error(`Oops the property P2P.IS_BOOTSTRAP_NODE is not a boolean.`);
            }

            if (
                parsedConfig.P2P.ENABLE_P2P_LOGGING !== undefined &&
                typeof parsedConfig.P2P.ENABLE_P2P_LOGGING !== 'boolean'
            ) {
                throw new Error(`Oops the property P2P.ENABLE_P2P_LOGGING is not a boolean.`);
            }

            if (parsedConfig.P2P.CLIENT_MODE && parsedConfig.P2P.IS_BOOTSTRAP_NODE) {
                throw new Error(
                    `Oops the property P2P.CLIENT_MODE and P2P.IS_BOOTSTRAP_NODE cannot be both true.`,
                );
            }

            if (
                parsedConfig.P2P.ENABLE_IPV6 !== undefined &&
                typeof parsedConfig.P2P.ENABLE_IPV6 !== 'boolean'
            ) {
                throw new Error(`Oops the property P2P.ENABLE_IPV6 is not a boolean.`);
            }

            if (
                parsedConfig.P2P.P2P_HOST_V6 !== undefined &&
                typeof parsedConfig.P2P.P2P_HOST_V6 !== 'string'
            ) {
                throw new Error(`Oops the property P2P.P2P_HOST_V6 is not a string.`);
            }

            if (
                parsedConfig.P2P.P2P_PORT_V6 !== undefined &&
                typeof parsedConfig.P2P.P2P_PORT_V6 !== 'number'
            ) {
                throw new Error(`Oops the property P2P.P2P_PORT_V6 is not a number.`);
            }

            if (
                parsedConfig.P2P.P2P_HOST !== undefined &&
                typeof parsedConfig.P2P.P2P_HOST !== 'string'
            ) {
                throw new Error(`Oops the property P2P.P2P_HOST is not a string.`);
            }

            if (
                parsedConfig.P2P.P2P_PORT !== undefined &&
                typeof parsedConfig.P2P.P2P_PORT !== 'number'
            ) {
                throw new Error(`Oops the property P2P.P2P_PORT is not a number.`);
            }

            if (
                parsedConfig.P2P.P2P_PROTOCOL !== undefined &&
                typeof parsedConfig.P2P.P2P_PROTOCOL !== 'string'
            ) {
                throw new Error(`Oops the property P2P.P2P_PROTOCOL is not a string.`);
            }

            if (
                parsedConfig.P2P.MAXIMUM_INBOUND_STREAMS !== undefined &&
                typeof parsedConfig.P2P.MAXIMUM_INBOUND_STREAMS !== 'number'
            ) {
                throw new Error(`Oops the property P2P.MAXIMUM_INBOUND_STREAMS is not a number.`);
            }

            if (
                parsedConfig.P2P.MAXIMUM_OUTBOUND_STREAMS !== undefined &&
                typeof parsedConfig.P2P.MAXIMUM_OUTBOUND_STREAMS !== 'number'
            ) {
                throw new Error(`Oops the property P2P.MAXIMUM_OUTBOUND_PEERS is not a number.`);
            }

            if (
                parsedConfig.P2P.BOOTSTRAP_NODES !== undefined &&
                !Array.isArray(parsedConfig.P2P.BOOTSTRAP_NODES)
            ) {
                throw new Error(`Oops the property P2P.BOOTSTRAP_NODES is not an array.`);
            }

            if (
                parsedConfig.P2P.TRUSTED_VALIDATORS !== undefined &&
                !Array.isArray(parsedConfig.P2P.TRUSTED_VALIDATORS)
            ) {
                throw new Error(`Oops the property P2P.TRUSTED_VALIDATORS is not an array.`);
            }

            if (
                parsedConfig.P2P.TRUSTED_VALIDATORS_CHECKSUM_HASH !== undefined &&
                typeof parsedConfig.P2P.TRUSTED_VALIDATORS_CHECKSUM_HASH !== 'string'
            ) {
                throw new Error(
                    `Oops the property P2P.TRUSTED_VALIDATORS_CHECKSUM_HASH is not a string.`,
                );
            }

            if (
                parsedConfig.P2P.PEER_INACTIVITY_TIMEOUT !== undefined &&
                typeof parsedConfig.P2P.PEER_INACTIVITY_TIMEOUT !== 'number'
            ) {
                throw new Error(`Oops the property P2P.PEER_INACTIVITY_TIMEOUT is not a number.`);
            }

            if (
                parsedConfig.P2P.MINIMUM_PEERS !== undefined &&
                typeof parsedConfig.P2P.MINIMUM_PEERS !== 'number'
            ) {
                throw new Error(`Oops the property P2P.MINIMUM_PEERS is not a number.`);
            }

            if (
                parsedConfig.P2P.MAXIMUM_PEERS !== undefined &&
                typeof parsedConfig.P2P.MAXIMUM_PEERS !== 'number'
            ) {
                throw new Error(`Oops the property P2P.MAXIMUM_PEERS is not a number.`);
            }
        }

        if (parsedConfig.MEMPOOL) {
            if (
                parsedConfig.MEMPOOL.EXPIRATION_BLOCKS !== undefined &&
                typeof parsedConfig.MEMPOOL.EXPIRATION_BLOCKS !== 'number'
            ) {
                throw new Error(`Oops the property MEMPOOL.EXPIRATION_BLOCKS is not a number.`);
            }

            if (
                parsedConfig.MEMPOOL.PREVENT_TX_BROADCAST_IF_NOT_SYNCED !== undefined &&
                typeof parsedConfig.MEMPOOL.PREVENT_TX_BROADCAST_IF_NOT_SYNCED !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property MEMPOOL.PREVENT_TX_BROADCAST_IF_NOT_SYNCED is not a boolean.`,
                );
            }

            if (
                parsedConfig.MEMPOOL.THREADS !== undefined &&
                typeof parsedConfig.MEMPOOL.THREADS !== 'number'
            ) {
                throw new Error(`Oops the property MEMPOOL.THREADS is not a number.`);
            }

            if (
                parsedConfig.MEMPOOL.ENABLE_BLOCK_PURGE !== undefined &&
                typeof parsedConfig.MEMPOOL.ENABLE_BLOCK_PURGE !== 'boolean'
            ) {
                throw new Error(`Oops the property MEMPOOL.ENABLE_BLOCK_PURGE is not a boolean.`);
            }

            if (
                parsedConfig.MEMPOOL.BATCH_SIZE !== undefined &&
                typeof parsedConfig.MEMPOOL.BATCH_SIZE !== 'number'
            ) {
                throw new Error(`Oops the property MEMPOOL.BATCH_SIZE is not a number.`);
            }

            if (
                parsedConfig.MEMPOOL.FETCH_INTERVAL !== undefined &&
                typeof parsedConfig.MEMPOOL.FETCH_INTERVAL !== 'number'
            ) {
                throw new Error(`Oops the property MEMPOOL.FETCH_INTERVAL is not a number.`);
            }
        }

        if (parsedConfig.SSH) {
            if (parsedConfig.SSH.ENABLED && typeof parsedConfig.SSH.ENABLED !== 'boolean') {
                throw new Error(`Oops the property SSH.ENABLED is not a boolean.`);
            }

            if (parsedConfig.SSH.PORT === undefined || typeof parsedConfig.SSH.PORT !== 'number') {
                throw new Error(`Oops the property SSH.PORT is not a number.`);
            }

            if (parsedConfig.SSH.HOST === undefined || typeof parsedConfig.SSH.HOST !== 'string') {
                throw new Error(`Oops the property SSH.HOST is not a string.`);
            }

            if (
                parsedConfig.SSH.USERNAME === undefined ||
                typeof parsedConfig.SSH.USERNAME !== 'string'
            ) {
                throw new Error(`Oops the property SSH.USERNAME is not a string.`);
            }

            if (
                parsedConfig.SSH.PASSWORD === undefined ||
                typeof parsedConfig.SSH.PASSWORD !== 'string'
            ) {
                throw new Error(`Oops the property SSH.PASSWORD is not a string.`);
            }

            if (
                parsedConfig.SSH.PUBLIC_KEY === undefined ||
                typeof parsedConfig.SSH.PUBLIC_KEY !== 'string'
            ) {
                throw new Error(`Oops the property SSH.PUBLIC_KEY is not a string.`);
            }

            if (
                parsedConfig.SSH.NO_AUTH === undefined ||
                typeof parsedConfig.SSH.NO_AUTH !== 'boolean'
            ) {
                throw new Error(`Oops the property SSH.NO_AUTH is not a boolean.`);
            }

            if (
                parsedConfig.SSH.ALLOWED_IPS === undefined ||
                !Array.isArray(parsedConfig.SSH.ALLOWED_IPS)
            ) {
                throw new Error(`Oops the property SSH.ALLOWED_IPS is not an array.`);
            }
        }

        if (parsedConfig.API) {
            if (
                parsedConfig.API.MAXIMUM_PENDING_REQUESTS_PER_THREADS &&
                typeof parsedConfig.API.MAXIMUM_PENDING_REQUESTS_PER_THREADS !== 'number'
            ) {
                throw new Error(
                    `Oops the property API.MAXIMUM_PENDING_REQUESTS_PER_THREADS is not a number.`,
                );
            }

            if (
                parsedConfig.API.BATCH_PROCESSING_SIZE &&
                typeof parsedConfig.API.BATCH_PROCESSING_SIZE !== 'number'
            ) {
                throw new Error(`Oops the property API.BATCH_PROCESSING_SIZE is not a number.`);
            }

            if (
                parsedConfig.API.MAXIMUM_PARALLEL_BLOCK_QUERY &&
                typeof parsedConfig.API.MAXIMUM_PARALLEL_BLOCK_QUERY !== 'number'
            ) {
                throw new Error(
                    `Oops the property API.MAXIMUM_PARALLEL_BLOCK_QUERY is not a number.`,
                );
            }

            if (
                parsedConfig.API.MAXIMUM_TRANSACTION_BROADCAST &&
                typeof parsedConfig.API.MAXIMUM_TRANSACTION_BROADCAST !== 'number'
            ) {
                throw new Error(
                    `Oops the property API.MAXIMUM_TRANSACTION_BROADCAST is not a number.`,
                );
            }

            if (
                parsedConfig.API.MAXIMUM_PENDING_CALL_REQUESTS &&
                typeof parsedConfig.API.MAXIMUM_PENDING_CALL_REQUESTS !== 'number'
            ) {
                throw new Error(
                    `Oops the property API.MAXIMUM_PENDING_CALL_REQUESTS is not a number.`,
                );
            }

            if (parsedConfig.API.UTXO_LIMIT && typeof parsedConfig.API.UTXO_LIMIT !== 'number') {
                throw new Error(`Oops the property API.UTXO_LIMIT is not a number.`);
            }

            if (
                parsedConfig.API.MAXIMUM_REQUESTS_PER_BATCH &&
                typeof parsedConfig.API.MAXIMUM_REQUESTS_PER_BATCH !== 'number'
            ) {
                throw new Error(
                    `Oops the property API.MAXIMUM_REQUESTS_PER_BATCH is not a number.`,
                );
            }

            if (parsedConfig.API.THREADS && typeof parsedConfig.API.THREADS !== 'number') {
                throw new Error(`Oops the property API.THREADS is not a number.`);
            }
        }

        if (parsedConfig.DEV) {
            if (
                parsedConfig.DEV.PROCESS_ONLY_X_BLOCK !== undefined &&
                typeof parsedConfig.DEV.PROCESS_ONLY_X_BLOCK !== 'number'
            ) {
                throw new Error(`Oops the property DEV.PROCESS_ONLY_X_BLOCK is not a number.`);
            }

            if (
                parsedConfig.DEV.DEBUG_TRANSACTION_FAILURE !== undefined &&
                typeof parsedConfig.DEV.DEBUG_TRANSACTION_FAILURE !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property DEV.DEBUG_TRANSACTION_FAILURE is not a boolean.`,
                );
            }

            if (
                parsedConfig.DEV.DEBUG_TRANSACTION_PARSE_FAILURE !== undefined &&
                typeof parsedConfig.DEV.DEBUG_TRANSACTION_PARSE_FAILURE !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property DEV.DEBUG_TRANSACTION_FAILURE is not a boolean.`,
                );
            }

            if (
                parsedConfig.DEV.CAUSE_FETCHING_FAILURE !== undefined &&
                typeof parsedConfig.DEV.CAUSE_FETCHING_FAILURE !== 'boolean'
            ) {
                throw new Error(`Oops the property DEV.CAUSE_FETCHING_FAILURE is not a boolean.`);
            }

            if (
                parsedConfig.DEV.DISPLAY_VALID_BLOCK_WITNESS !== undefined &&
                typeof parsedConfig.DEV.DISPLAY_VALID_BLOCK_WITNESS !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property DEV.DISPLAY_VALID_BLOCK_WITNESS is not a boolean.`,
                );
            }

            if (
                parsedConfig.DEV.DISPLAY_INVALID_BLOCK_WITNESS !== undefined &&
                typeof parsedConfig.DEV.DISPLAY_INVALID_BLOCK_WITNESS !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property DEV.DISPLAY_INVALID_BLOCK_WITNESS is not a boolean.`,
                );
            }

            if (
                parsedConfig.DEV.ENABLE_CONTRACT_DEBUG !== undefined &&
                typeof parsedConfig.DEV.ENABLE_CONTRACT_DEBUG !== 'boolean'
            ) {
                throw new Error(`Oops the property DEV.ENABLE_CONTRACT_DEBUG is not a boolean.`);
            }

            if (
                parsedConfig.DEV.ALWAYS_ENABLE_REORG_VERIFICATION !== undefined &&
                typeof parsedConfig.DEV.ALWAYS_ENABLE_REORG_VERIFICATION !== 'boolean'
            ) {
                throw new Error(
                    `Oops the property DEV.ALWAYS_ENABLE_REORG_VERIFICATION is not a boolean.`,
                );
            }

            if (
                parsedConfig.DEV.ENABLE_REORG_NIGHTMARE !== undefined &&
                typeof parsedConfig.DEV.ENABLE_REORG_NIGHTMARE !== 'boolean'
            ) {
                throw new Error(`Oops the property DEV.ENABLE_REORG_NIGHTMARE is not a boolean.`);
            }

            if (
                parsedConfig.DEV.SAVE_TIMEOUTS_TO_FILE !== undefined &&
                typeof parsedConfig.DEV.SAVE_TIMEOUTS_TO_FILE !== 'boolean'
            ) {
                throw new Error(`Oops the property DEV.SAVE_TIMEOUTS_TO_FILE is not a boolean.`);
            }

            if (
                !parsedConfig.DEV.SIMULATE_HIGH_GAS_USAGE &&
                typeof parsedConfig.DEV.SIMULATE_HIGH_GAS_USAGE !== 'boolean'
            ) {
                throw new Error(`Oops the property DEV.SIMULATE_HIGH_GAS_USAGE is not a boolean.`);
            }

            if (
                parsedConfig.DEV.DEBUG_VALID_TRANSACTIONS !== undefined &&
                typeof parsedConfig.DEV.DEBUG_VALID_TRANSACTIONS !== 'boolean'
            ) {
                throw new Error(`Oops the property DEV.DEBUG_VALID_TRANSACTIONS is not a boolean.`);
            }

            if (
                parsedConfig.DEV.DEBUG_API_ERRORS !== undefined &&
                typeof parsedConfig.DEV.DEBUG_API_ERRORS !== 'boolean'
            ) {
                throw new Error(`Oops the property DEV.DEBUG_API_ERRORS is not a boolean.`);
            }
        }

        if (parsedConfig.DATABASE?.AUTH) {
            parsedConfig.DATABASE.AUTH.PASSWORD = encodeURIComponent(
                parsedConfig.DATABASE.AUTH.PASSWORD,
            );
        }

        if (parsedConfig.BASE58) {
            this.verifyBase58Configs(parsedConfig.BASE58);
        }

        if (parsedConfig.BECH32) {
            this.verifyBech32Configs(parsedConfig.BECH32);
        }

        this.verifiedConfig = true;
    }

    protected override parsePartialConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        super.parsePartialConfig(parsedConfig);

        this.parseConfig(parsedConfig);
    }

    private verifyBech32Configs(parsedConfig: Partial<IBtcIndexerConfig['BECH32']>): void {
        if (parsedConfig.HRP && typeof parsedConfig.HRP !== 'string') {
            throw new Error(`Oops the property BECH32.HRP is not a string.`);
        }
    }

    private verifyBase58Configs(parsedConfig: Partial<IBtcIndexerConfig['BASE58']>): void {
        if (
            typeof parsedConfig.PUBKEY_ADDRESS !== 'string' &&
            parsedConfig.PUBKEY_ADDRESS !== undefined
        ) {
            throw new Error(`Oops the property BASE58.PUBKEY_ADDRESS is not a string.`);
        } else if (parsedConfig.PUBKEY_ADDRESS) {
            parsedConfig.PUBKEY_ADDRESS = Number(parsedConfig.PUBKEY_ADDRESS);

            if (isNaN(parsedConfig.PUBKEY_ADDRESS)) {
                throw new Error(`Oops the property BASE58.PUBKEY_ADDRESS is not a number.`);
            }
        }

        if (
            typeof parsedConfig.SCRIPT_ADDRESS !== 'string' &&
            parsedConfig.SCRIPT_ADDRESS !== undefined
        ) {
            throw new Error(`Oops the property BASE58.SCRIPT_ADDRESS is not a string.`);
        } else if (parsedConfig.SCRIPT_ADDRESS) {
            parsedConfig.SCRIPT_ADDRESS = Number(parsedConfig.SCRIPT_ADDRESS);

            if (isNaN(parsedConfig.SCRIPT_ADDRESS)) {
                throw new Error(`Oops the property BASE58.SCRIPT_ADDRESS is not a number.`);
            }
        }

        if (typeof parsedConfig.SECRET_KEY !== 'string' && parsedConfig.SECRET_KEY !== undefined) {
            throw new Error(`Oops the property BASE58.SECRET_KEY is not a number.`);
        } else if (parsedConfig.SECRET_KEY) {
            parsedConfig.SECRET_KEY = Number(parsedConfig.SECRET_KEY);

            if (isNaN(parsedConfig.SECRET_KEY)) {
                throw new Error(`Oops the property BASE58.SECRET_KEY is not a number.`);
            }
        }

        if (
            typeof parsedConfig.EXT_PUBLIC_KEY !== 'string' &&
            parsedConfig.EXT_PUBLIC_KEY !== undefined
        ) {
            throw new Error(`Oops the property BASE58.EXT_PUBLIC_KEY is not a string.`);
        } else if (parsedConfig.EXT_PUBLIC_KEY) {
            parsedConfig.EXT_PUBLIC_KEY = Number(parsedConfig.EXT_PUBLIC_KEY);

            if (isNaN(parsedConfig.EXT_PUBLIC_KEY)) {
                throw new Error(`Oops the property BASE58.EXT_PUBLIC_KEY is not a number.`);
            }
        }

        if (
            typeof parsedConfig.EXT_SECRET_KEY !== 'string' &&
            parsedConfig.EXT_SECRET_KEY !== undefined
        ) {
            throw new Error(`Oops the property BASE58.EXT_SECRET_KEY is not a string.`);
        } else if (parsedConfig.EXT_SECRET_KEY) {
            parsedConfig.EXT_SECRET_KEY = Number(parsedConfig.EXT_SECRET_KEY);

            if (isNaN(parsedConfig.EXT_SECRET_KEY)) {
                throw new Error(`Oops the property BASE58.EXT_SECRET_KEY is not a number.`);
            }
        }
    }

    private parseConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        const defaultConfigs = this.getDefaultConfig();

        this.config.DEV_MODE = parsedConfig.DEV_MODE ?? defaultConfigs.DEV_MODE;

        this.config.INDEXER = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['INDEXER']
        >(parsedConfig.INDEXER, defaultConfigs.INDEXER);

        this.config.RPC = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['RPC']>(
            parsedConfig.RPC,
            defaultConfigs.RPC,
        );

        this.config.OP_NET = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['OP_NET']
        >(parsedConfig.OP_NET, defaultConfigs.OP_NET);

        this.config.P2P = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['P2P']>(
            parsedConfig.P2P,
            defaultConfigs.P2P,
        );

        this.config.POC = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['POC']>(
            parsedConfig.POC,
            defaultConfigs.POC,
        );

        this.config.MEMPOOL = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['MEMPOOL']
        >(parsedConfig.MEMPOOL, defaultConfigs.MEMPOOL);

        this.config.BLOCKCHAIN = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['BLOCKCHAIN']
        >(parsedConfig.BLOCKCHAIN, defaultConfigs.BLOCKCHAIN);

        this.config.DATABASE = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['DATABASE']
        >(parsedConfig.DATABASE, defaultConfigs.DATABASE);

        this.config.DOCS = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['DOCS']
        >(parsedConfig.DOCS, defaultConfigs.DOCS);

        this.config.SSH = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['SSH']>(
            parsedConfig.SSH,
            defaultConfigs.SSH,
        );

        this.config.API = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['API']>(
            parsedConfig.API,
            defaultConfigs.API,
        );

        this.config.BECH32 = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['BECH32']
        >(parsedConfig.BECH32 || {}, defaultConfigs.BECH32 || {});

        this.config.BASE58 = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['BASE58']
        >(parsedConfig.BASE58 || {}, defaultConfigs.BASE58 || {});

        this.config.BITCOIN = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['BITCOIN']
        >(parsedConfig.BITCOIN || {}, defaultConfigs.BITCOIN || {});

        this.config.DEV = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['DEV']>(
            parsedConfig.DEV,
            defaultConfigs.DEV,
        );
    }

    private getConfigModified<U extends keyof IBtcIndexerConfig, T extends IBtcIndexerConfig[U]>(
        config: Partial<T> | undefined,
        defaultConfig: T | undefined,
    ): T {
        if (!defaultConfig) {
            throw new Error(`Oops the default config is not defined.`);
        }

        const newIndexerConfig: Partial<T> = {};
        const configData: Partial<T> = config || {};
        for (const setting of Object.keys(defaultConfig)) {
            const settingKey = setting as keyof T;

            newIndexerConfig[settingKey] = configData[settingKey] ?? defaultConfig[settingKey];
        }

        return newIndexerConfig as T;
    }
}
