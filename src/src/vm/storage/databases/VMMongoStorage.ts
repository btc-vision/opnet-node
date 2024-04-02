import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';
import { MemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { VMStorage } from '../VMStorage.js';

export class VMMongoStorage extends VMStorage {
    constructor() {
        super();
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
