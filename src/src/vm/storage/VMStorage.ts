import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';
import { Logger } from '../../logger/Logger.js';
import { MemoryValue } from './types/MemoryValue.js';
import { StoragePointer } from './types/StoragePointer.js';

export class VMStorage extends Logger {
    public readonly logColor: string = '#ff00ff';

    constructor() {
        super();
    }

    public getStorage(address: BitcoinAddress, pointer: StoragePointer): MemoryValue {
        return Buffer.from('');
    }

    public setStorage(address: BitcoinAddress, pointer: StoragePointer, value: MemoryValue): void {
        return;
    }
}
