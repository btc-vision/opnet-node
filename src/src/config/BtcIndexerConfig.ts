import { ConfigBase, IConfig } from '@btc-vision/motoswapcommon';
import { IBtcIndexerConfig, IndexerConfig, ZeroMQConfig } from './interfaces/IBtcIndexerConfig';

import '../utils/Globals.js';

export class BtcIndexerConfig extends ConfigBase<IConfig<IBtcIndexerConfig>> {
    public readonly INDEXER: IndexerConfig;
    public readonly ZERO_MQ: ZeroMQConfig;

    constructor(config: IConfig<IBtcIndexerConfig>) {
        super(config);

        this.INDEXER = config.INDEXER;
        this.ZERO_MQ = config.ZERO_MQ;
    }
}
