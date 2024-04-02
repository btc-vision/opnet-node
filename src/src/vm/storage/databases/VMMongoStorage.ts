import { ConfigurableDBManager } from '@btc-vision/motoswapdb';
import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';
import { IBtcIndexerConfig } from '../../../config/interfaces/IBtcIndexerConfig.js';
import { MemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { VMStorage } from '../VMStorage.js';

export class VMMongoStorage extends VMStorage {
    private db: ConfigurableDBManager;

    constructor(private readonly config: IBtcIndexerConfig) {
        super();

        this.db = new ConfigurableDBManager(this.config);
    }

    public async init(): Promise<void> {
        await this.db.setup(this.config.DATABASE.DATABASE_NAME);
        await this.db.connect();
    }

    public async close(): Promise<void> {
        await this.db.close();
    }

    public async getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
    ): Promise<MemoryValue | null> {
        return null;
    }

    public async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        return;
    }
}
