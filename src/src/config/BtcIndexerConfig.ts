import { ConfigBase, IConfig } from '@btc-vision/bsi-common';
import {
    IBtcIndexerConfig,
    IndexerConfig,
    MempoolConfig,
    OPNetConfig,
    P2P,
    PoA,
    RPCConfig,
    SSHConfig,
    ZeroMQConfig,
} from './interfaces/IBtcIndexerConfig';

import '../utils/Globals.js';

export class BtcIndexerConfig extends ConfigBase<IConfig<IBtcIndexerConfig>> {
    public readonly INDEXER: IndexerConfig;
    public readonly ZERO_MQ: ZeroMQConfig;
    public readonly RPC: RPCConfig;
    public readonly OP_NET: OPNetConfig;

    public readonly POA: PoA;
    public readonly P2P: P2P;
    public readonly SSH: SSHConfig;

    public readonly MEMPOOL: MempoolConfig;

    constructor(config: IConfig<IBtcIndexerConfig>) {
        super(config);

        this.INDEXER = config.INDEXER;
        this.ZERO_MQ = config.ZERO_MQ;
        this.RPC = config.RPC;
        this.OP_NET = config.OP_NET;

        this.SSH = config.SSH;

        this.P2P = config.P2P;
        this.POA = config.POA;

        this.MEMPOOL = config.MEMPOOL;
    }
}
