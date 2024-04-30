import { ConfigManager, IConfig } from '@btc-vision/bsi-common';
import { BitcoinZeroMQTopic } from '../blockchain-indexer/zeromq/enums/BitcoinZeroMQTopic.js';
import { IndexerStorageType } from '../vm/storage/types/IndexerStorageType.js';
import { BtcIndexerConfig } from './BtcIndexerConfig.js';
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
            ENABLED: false,
            P2P_HOST: '0.0.0.0',
            P2P_PORT: 9800,
            P2P_PROTOCOL: PeerToPeerMethod.UDP,
            MAXIMUM_INBOUND_PEERS: 20,
            MAXIMUM_OUTBOUND_PEERS: 20,
            BOOTSTRAP_NODES: [],
            TRUSTED_VALIDATORS: [],
            TRUSTED_VALIDATORS_CHECKSUM_HASH: '',
        },

        POA: {
            ENABLED: false,
        },

        OP_NET: {
            TRANSACTIONS_THREADS: 4,
            TRANSACTIONS_MAXIMUM_CONCURRENT: 100,

            ENABLED_AT_BLOCK: 0,
            REINDEX: false,
            REINDEX_FROM_BLOCK: 0,
            VERIFY_INTEGRITY_ON_STARTUP: false,
            DISABLE_SCANNED_BLOCK_STORAGE_CHECK: true,
            MODE: OPNetIndexerMode.ARCHIVE,
        },
    };

    constructor(fullFileName: string) {
        super(fullFileName);
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
                parsedConfig.OP_NET.TRANSACTIONS_THREADS !== undefined &&
                typeof parsedConfig.OP_NET.TRANSACTIONS_THREADS !== 'number'
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

        if (parsedConfig.POA) {
            if (
                parsedConfig.POA.ENABLED === undefined ||
                typeof parsedConfig.POA.ENABLED !== 'boolean'
            ) {
                throw new Error(`Oops the property POA.ENABLED is not a boolean.`);
            }
        }

        if (parsedConfig.P2P) {
            if (
                parsedConfig.P2P.ENABLED === undefined ||
                typeof parsedConfig.P2P.ENABLED !== 'boolean'
            ) {
                throw new Error(`Oops the property P2P.ENABLED is not a boolean.`);
            }

            if (
                parsedConfig.P2P.P2P_HOST === undefined ||
                typeof parsedConfig.P2P.P2P_HOST !== 'string'
            ) {
                throw new Error(`Oops the property P2P.P2P_HOST is not a string.`);
            }

            if (
                parsedConfig.P2P.P2P_PORT === undefined ||
                typeof parsedConfig.P2P.P2P_PORT !== 'number'
            ) {
                throw new Error(`Oops the property P2P.P2P_PORT is not a number.`);
            }

            if (
                parsedConfig.P2P.P2P_PROTOCOL === undefined ||
                typeof parsedConfig.P2P.P2P_PROTOCOL !== 'string'
            ) {
                throw new Error(`Oops the property P2P.P2P_PROTOCOL is not a string.`);
            }

            if (
                parsedConfig.P2P.MAXIMUM_INBOUND_PEERS === undefined ||
                typeof parsedConfig.P2P.MAXIMUM_INBOUND_PEERS !== 'number'
            ) {
                throw new Error(`Oops the property P2P.MAXIMUM_INBOUND_PEERS is not a number.`);
            }

            if (
                parsedConfig.P2P.MAXIMUM_OUTBOUND_PEERS === undefined ||
                typeof parsedConfig.P2P.MAXIMUM_OUTBOUND_PEERS !== 'number'
            ) {
                throw new Error(`Oops the property P2P.MAXIMUM_OUTBOUND_PEERS is not a number.`);
            }

            if (
                parsedConfig.P2P.BOOTSTRAP_NODES === undefined ||
                !Array.isArray(parsedConfig.P2P.BOOTSTRAP_NODES)
            ) {
                throw new Error(`Oops the property P2P.BOOTSTRAP_NODES is not an array.`);
            }

            if (
                parsedConfig.P2P.TRUSTED_VALIDATORS === undefined ||
                !Array.isArray(parsedConfig.P2P.TRUSTED_VALIDATORS)
            ) {
                throw new Error(`Oops the property P2P.TRUSTED_VALIDATORS is not an array.`);
            }

            if (
                parsedConfig.P2P.TRUSTED_VALIDATORS_CHECKSUM_HASH === undefined ||
                typeof parsedConfig.P2P.TRUSTED_VALIDATORS_CHECKSUM_HASH !== 'string'
            ) {
                throw new Error(
                    `Oops the property P2P.TRUSTED_VALIDATORS_CHECKSUM_HASH is not a string.`,
                );
            }
        }
    }

    protected override parsePartialConfig(parsedConfig: Partial<IBtcIndexerConfig>): void {
        this.verifyConfig(parsedConfig);
        super.parsePartialConfig(parsedConfig);

        this.config.INDEXER = {
            ...parsedConfig.INDEXER,
            ...this.config.INDEXER,
        };

        this.config.ZERO_MQ = {
            ...parsedConfig.ZERO_MQ,
            ...this.config.ZERO_MQ,
        };

        this.config.RPC = {
            ...parsedConfig.RPC,
            ...this.config.RPC,
        };

        this.config.BLOCKCHAIN = {
            ...parsedConfig.BLOCKCHAIN,
            ...this.config.BLOCKCHAIN,
        };

        this.config.OP_NET = {
            ...parsedConfig.OP_NET,
            ...this.config.OP_NET,
        };

        this.config.P2P = {
            ...parsedConfig.P2P,
            ...this.config.P2P,
        };

        this.config.POA = {
            ...parsedConfig.POA,
            ...this.config.POA,
        };
    }
}
