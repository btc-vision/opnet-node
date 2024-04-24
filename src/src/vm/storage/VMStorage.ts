import { Logger } from '@btc-vision/bsi-common';
import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
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

    public abstract hasContractAt(address: BitcoinAddress): Promise<boolean>;

    public abstract getContractAt(address: BitcoinAddress): Promise<ContractInformation | null>;

    public abstract getContractAtVirtualAddress(
        virtualAddress: string,
    ): Promise<ContractInformation | null>;

    public abstract setContractAt(contractData: ContractInformation): Promise<void>;

    public abstract prepareNewBlock(): Promise<void>;

    public abstract terminateBlock(): Promise<void>;

    public abstract revertChanges(): Promise<void>;

    public abstract init(): Promise<void>;

    public abstract close(): Promise<void>;
}
