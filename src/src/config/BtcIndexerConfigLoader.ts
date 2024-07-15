import { ConfigManager, IConfig } from '@btc-vision/bsi-common';
import { BitcoinZeroMQTopic } from '../blockchain-indexer/zeromq/enums/BitcoinZeroMQTopic.js';
import { IndexerStorageType } from '../vm/storage/types/IndexerStorageType.js';
import { BtcIndexerConfig } from './BtcIndexerConfig.js';
import { ChainIds } from './enums/ChainIds.js';
import { IBtcIndexerConfig } from './interfaces/IBtcIndexerConfig.js';
import { OPNetIndexerMode } from './interfaces/OPNetIndexerMode.js';
import { PeerToPeerMethod } from './interfaces/PeerToPeerMethod.js';

export class BtcIndexerConfigManager extends ConfigManager<IConfig<IBtcIndexerConfig>> {
    private defaultConfig: Partial<IBtcIndexerConfig> = {
        INDEXER: {
            ENABLED: false,
            STORAGE_TYPE: IndexerStorageType.MONGODB,
        },

        ZERO_MQ: {},

        P2P: {
            IS_BOOTSTRAP_NODE: false,
            CLIENT_MODE: false,
            ENABLE_IPV6: false,

            MDNS: false,

            P2P_HOST_V6: '::',
            P2P_PORT_V6: 9801,

            P2P_HOST: '0.0.0.0',
            P2P_PORT: 9800,
            P2P_PROTOCOL: PeerToPeerMethod.TCP,

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

            BATCH_PROCESSING_SIZE: 10,
            MAXIMUM_PARALLEL_BLOCK_QUERY: 50, // on mainnet, 50 blocks can load a lot of data in memory.
        },

        POA: {
            ENABLED: false,
        },

        MEMPOOL: {
            THREADS: 2,
            EXPIRATION_BLOCKS: 20,
        },

        RPC: {
            THREADS: 2,
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
            MAXIMUM_TRANSACTION_SESSIONS: 12,
            TRANSACTIONS_MAXIMUM_CONCURRENT: 100,
            MAXIMUM_PREFETCH_BLOCKS: 10,

            ENABLED_AT_BLOCK: 0,
            REINDEX: false,
            REINDEX_FROM_BLOCK: 0,
            VERIFY_INTEGRITY_ON_STARTUP: false,
            DISABLE_SCANNED_BLOCK_STORAGE_CHECK: true,

            CHAIN_ID: ChainIds.Bitcoin,
            MODE: OPNetIndexerMode.ARCHIVE,
        },
    };

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

        if (parsedConfig.OP_NET) {
            if (
                parsedConfig.OP_NET.ENABLED_AT_BLOCK === undefined ||
                typeof parsedConfig.OP_NET.ENABLED_AT_BLOCK !== 'number'
            ) {
                throw new Error(`Oops the property OP_NET.ENABLED_AT_BLOCK is not a number.`);
            }

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

            if (!(parsedConfig.OP_NET.MODE in OPNetIndexerMode)) {
                throw new Error(
                    `Oops the property OP_NET.MODE is not a valid OPNetIndexerMode enum value.`,
                );
            }

            if (
                parsedConfig.OP_NET.MAXIMUM_TRANSACTION_SESSIONS !== undefined &&
                typeof parsedConfig.OP_NET.MAXIMUM_TRANSACTION_SESSIONS !== 'number'
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

            if (
                parsedConfig.OP_NET.CHAIN_ID !== undefined &&
                typeof parsedConfig.OP_NET.CHAIN_ID !== 'number'
            ) {
                throw new Error(`Oops the property OP_NET.CHAIN_ID is not a number.`);
            }

            if (
                parsedConfig.OP_NET.CHAIN_ID !== undefined &&
                parsedConfig.OP_NET.CHAIN_ID in ChainIds
            ) {
                throw new Error(
                    `Oops the property OP_NET.CHAIN_ID is not a valid ChainIds enum value.`,
                );
            }
        }

        if (parsedConfig.POA) {
            if (
                parsedConfig.POA.ENABLED !== undefined &&
                typeof parsedConfig.POA.ENABLED !== 'boolean'
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
                parsedConfig.P2P.IS_BOOTSTRAP_NODE !== undefined &&
                typeof parsedConfig.P2P.IS_BOOTSTRAP_NODE !== 'boolean'
            ) {
                throw new Error(`Oops the property P2P.IS_BOOTSTRAP_NODE is not a boolean.`);
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
                parsedConfig.MEMPOOL.THREADS !== undefined &&
                typeof parsedConfig.MEMPOOL.THREADS !== 'number'
            ) {
                throw new Error(`Oops the property MEMPOOL.THREADS is not a number.`);
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
        }
    }

    protected override parsePartialConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        this.verifyConfig(parsedConfig);
        super.parsePartialConfig(parsedConfig);

        this.parseConfig(parsedConfig);
    }

    private parseConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        const defaultConfigs = this.getDefaultConfig();

        this.config.INDEXER = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['INDEXER']
        >(parsedConfig.INDEXER, defaultConfigs.INDEXER);

        this.config.ZERO_MQ = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['ZERO_MQ']
        >(parsedConfig.ZERO_MQ, defaultConfigs.ZERO_MQ);

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

        this.config.POA = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['POA']>(
            parsedConfig.POA,
            defaultConfigs.POA,
        );

        this.config.MEMPOOL = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['MEMPOOL']
        >(parsedConfig.MEMPOOL, defaultConfigs.MEMPOOL);

        this.config.BLOCKCHAIN = this.getConfigModified<
            keyof IBtcIndexerConfig,
            IBtcIndexerConfig['BLOCKCHAIN']
        >(parsedConfig.BLOCKCHAIN, defaultConfigs.BLOCKCHAIN);

        this.config.SSH = this.getConfigModified<keyof IBtcIndexerConfig, IBtcIndexerConfig['SSH']>(
            parsedConfig.SSH,
            defaultConfigs.SSH,
        );
    }

    private getConfigModified<U extends keyof IBtcIndexerConfig, T extends IBtcIndexerConfig[U]>(
        config: Partial<T> | undefined,
        defaultConfig: T | undefined,
    ): T {
        if (!defaultConfig) {
            throw new Error(`Oops the default config is not defined.`);
        }

        let newIndexerConfig: Partial<T> = {};
        let configData: Partial<T> = config || {};
        for (let setting of Object.keys(defaultConfig)) {
            const settingKey = setting as keyof T;

            newIndexerConfig[settingKey] = configData[settingKey] || defaultConfig[settingKey];
        }

        return newIndexerConfig as T;
    }
}
