import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';
import { MemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';

export interface IVMStorageMethod {
    getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null,
        setIfNotExit: boolean,
    ): Promise<MemoryValue | null>;

    setStorage(address: BitcoinAddress, pointer: StoragePointer, value: MemoryValue): Promise<void>;
}
