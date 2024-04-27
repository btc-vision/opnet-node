import { ConfigBase, IConfig } from '@btc-vision/bsi-common';
import {
    IBtcIndexerConfig,
    IndexerConfig,
    OPNetConfig,
    P2P,
    PoA,
    RPCConfig,
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

    constructor(config: IConfig<IBtcIndexerConfig>) {
        super(config);

        this.INDEXER = config.INDEXER;
        this.ZERO_MQ = config.ZERO_MQ;
        this.RPC = config.RPC;
        this.OP_NET = config.OP_NET;

        this.P2P = config.P2P;
        this.POA = config.POA;
    }
}
