import { ConfigBase, IConfig } from '@btc-vision/bsi-common';
import {
    APIExtendedConfigurations,
    Base58Config,
    Bech32Config,
    BitcoinConfig,
    BlockchainConfig,
    DevConfig,
    DocsConfig,
    EpochConfigs,
    IBtcIndexerConfig,
    IndexerConfig,
    MempoolConfig,
    OPNetConfig,
    P2P,
    PluginsConfig,
    PoC,
    RPCConfig,
    SSHConfig,
} from './interfaces/IBtcIndexerConfig.js';

import '../utils/Globals.js';

export class BtcIndexerConfig extends ConfigBase<IConfig<IBtcIndexerConfig>> {
    public readonly INDEXER: IndexerConfig;
    public readonly RPC: RPCConfig;
    public readonly OP_NET: OPNetConfig;

    public readonly POC: PoC;
    public readonly P2P: P2P;
    public readonly SSH: SSHConfig;

    public readonly EPOCH: EpochConfigs;

    public readonly API: APIExtendedConfigurations;

    public readonly MEMPOOL: MempoolConfig;

    public readonly DEV: DevConfig;
    public readonly DEV_MODE: boolean = false;

    public readonly BECH32: Bech32Config;
    public readonly BASE58: Base58Config;

    public readonly BLOCKCHAIN: BlockchainConfig;

    public readonly BITCOIN: BitcoinConfig;

    public readonly DOCS: DocsConfig;

    public readonly PLUGINS: PluginsConfig;

    constructor(config: IConfig<IBtcIndexerConfig>) {
        super(config);

        this.DEV = config.DEV;

        this.EPOCH = config.EPOCH;

        this.BECH32 = config.BECH32;
        this.BASE58 = config.BASE58;

        this.BITCOIN = config.BITCOIN;

        this.INDEXER = config.INDEXER;
        this.RPC = config.RPC;
        this.OP_NET = config.OP_NET;

        this.DEV_MODE = config.DEV_MODE;

        this.SSH = config.SSH;

        this.BLOCKCHAIN = config.BLOCKCHAIN;
        this.DOCS = config.DOCS;

        this.PLUGINS = config.PLUGINS;

        this.P2P = config.P2P;
        this.POC = config.POC;

        this.MEMPOOL = config.MEMPOOL;
        this.API = config.API;
    }
}
