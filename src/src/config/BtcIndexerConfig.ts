import { ConfigBase, IConfig } from '@btc-vision/bsi-common';
import {
    APIExtendedConfigurations,
    DevConfig,
    IBtcIndexerConfig,
    IndexerConfig,
    MempoolConfig,
    OPNetConfig,
    P2P,
    PoA,
    RPCConfig,
    SSHConfig,
} from './interfaces/IBtcIndexerConfig';

import '../utils/Globals.js';

export class BtcIndexerConfig extends ConfigBase<IConfig<IBtcIndexerConfig>> {
    public readonly INDEXER: IndexerConfig;
    public readonly RPC: RPCConfig;
    public readonly OP_NET: OPNetConfig;

    public readonly POA: PoA;
    public readonly P2P: P2P;
    public readonly SSH: SSHConfig;

    public readonly API: APIExtendedConfigurations;

    public readonly MEMPOOL: MempoolConfig;

    public readonly DEV: DevConfig;
    public readonly DEV_MODE: boolean = false;

    constructor(config: IConfig<IBtcIndexerConfig>) {
        super(config);

        this.DEV = config.DEV;

        this.INDEXER = config.INDEXER;
        this.RPC = config.RPC;
        this.OP_NET = config.OP_NET;

        this.DEV_MODE = config.DEV_MODE;

        this.SSH = config.SSH;

        this.P2P = config.P2P;
        this.POA = config.POA;

        this.MEMPOOL = config.MEMPOOL;
        this.API = config.API;
    }
}
