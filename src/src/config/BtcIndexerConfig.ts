import { ConfigBase, IConfig } from '@btc-vision/motoswapcommon';
import { IBtcIndexerConfig, IndexerConfig } from './interfaces/IBtcIndexerConfig';

export class BtcIndexerConfig extends ConfigBase<IConfig<IBtcIndexerConfig>> {
    public readonly INDEXER: IndexerConfig;

    constructor(config: IConfig<IBtcIndexerConfig>) {
        super(config);

        this.INDEXER = config.INDEXER;
    }
}
