import { Logger } from '@btc-vision/motoswapcommon';
import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';
import { IVMStorageMethod } from './interfaces/IVMStorageMethod.js';
import { MemoryValue } from './types/MemoryValue.js';
import { StoragePointer } from './types/StoragePointer.js';

export abstract class VMStorage extends Logger implements IVMStorageMethod {
    public readonly logColor: string = '#ff00ff';

    protected constructor() {
        super();
    }

    public abstract getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null,
        setIfNotExit: boolean,
    ): Promise<MemoryValue | null>;

    public abstract setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void>;

    public abstract prepareNewBlock(): Promise<void>;

    public abstract terminateBlock(): Promise<void>;

    public abstract revertChanges(): Promise<void>;

    public abstract init(): Promise<void>;

    public abstract close(): Promise<void>;
}
