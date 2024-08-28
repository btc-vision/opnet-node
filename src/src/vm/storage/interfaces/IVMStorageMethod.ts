import { MemoryValue, ProvenMemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { Address } from '@btc-vision/bsi-binary';

export interface IVMStorageMethod {
    getStorage(
        address: Address,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null,
        setIfNotExit: boolean,
    ): Promise<ProvenMemoryValue | null>;

    setStorage(
        address: Address,
        pointer: StoragePointer,
        value: MemoryValue,
        proofs: string[],
        lastSeenAt: bigint,
    ): Promise<void>;
}
