import { MemoryValue, ProvenMemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';

export interface IVMStorageMethod {
    getStorage(
        address: string,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null,
        setIfNotExit: boolean,
    ): Promise<ProvenMemoryValue | null>;

    setStorage(
        address: string,
        pointer: StoragePointer,
        value: MemoryValue,
        proofs: string[],
        lastSeenAt: bigint,
    ): Promise<void>;
}
