import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { Logger } from '@btc-vision/motoswapcommon';

new (class BlockchainIndexerManager extends Logger {
    public readonly logColor: string = '#1553c7';

    constructor() {
        super();

        void this.init();
    }

    private async init(): Promise<void> {
        this.log(`Starting up blockchain indexer manager...`);

        await DBManagerInstance.setup(Config.DATABASE.CONNECTION_TYPE);
        await DBManagerInstance.connect();
    }
})();
