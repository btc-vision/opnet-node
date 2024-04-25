import { Logger } from '@btc-vision/bsi-common';
import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';
import { BlockHeaderBlockDocument } from '../../blockchain-indexer/processor/block/interfaces/IBlockHeaderBlockDocument.js';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { BlockRootStates } from '../../db/interfaces/BlockRootStates.js';
import { IVMStorageMethod } from './interfaces/IVMStorageMethod.js';
import { MemoryValue, ProvenMemoryValue } from './types/MemoryValue.js';
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
        height?: bigint,
    ): Promise<ProvenMemoryValue | null>;

    public abstract setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
        proofs: string[],
        lastSeenAt: bigint,
    ): Promise<void>;

    public abstract hasContractAt(address: BitcoinAddress): Promise<boolean>;

    public abstract getContractAt(
        address: BitcoinAddress,
    ): Promise<ContractInformation | undefined>;

    public abstract getBlockRootStates(height: bigint): Promise<BlockRootStates | undefined>;

    public abstract saveBlockHeader(blockHeader: BlockHeaderBlockDocument): Promise<void>;
    public abstract getBlockHeader(height: bigint): Promise<BlockHeaderBlockDocument | undefined>;

    public abstract getContractAtVirtualAddress(
        virtualAddress: string,
    ): Promise<ContractInformation | undefined>;

    public abstract setContractAt(contractData: ContractInformation): Promise<void>;

    public abstract prepareNewBlock(): Promise<void>;

    public abstract terminateBlock(): Promise<void>;

    public abstract revertChanges(): Promise<void>;

    public abstract init(): Promise<void>;

    public abstract close(): Promise<void>;
}
