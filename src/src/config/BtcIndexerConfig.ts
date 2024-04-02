import { ConfigBase } from '@btc-vision/motoswapcommon';
import { IBtcIndexerConfig, IndexerConfig } from './interfaces/IBtcIndexerConfig';

export class BtcIndexerConfig extends ConfigBase implements IBtcIndexerConfig {
    public readonly INDEXER: IndexerConfig;

    constructor(config: IBtcIndexerConfig) {
        super(config);

        this.INDEXER = config.INDEXER;
    }
}
