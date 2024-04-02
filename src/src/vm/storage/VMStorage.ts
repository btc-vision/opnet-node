import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';
import { Logger } from '../../logger/Logger.js';
import { IVMStorageMethod } from './interfaces/IVMStorageMethod.js';
import { MemoryValue } from './types/MemoryValue.js';
import { StoragePointer } from './types/StoragePointer.js';

export class VMStorage extends Logger implements IVMStorageMethod {
    public readonly logColor: string = '#ff00ff';

    constructor() {
        super();
    }

    public async getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
    ): Promise<MemoryValue | null> {
        return Buffer.from('');
    }

    public async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        return;
    }
}
