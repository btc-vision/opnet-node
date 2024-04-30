import { Logger } from '@btc-vision/bsi-common';
import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { BlockWithTransactions } from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { BlockRootStates } from '../../db/interfaces/BlockRootStates.js';
import {
    BlockHeaderAPIBlockDocument,
    BlockHeaderBlockDocument,
} from '../../db/interfaces/IBlockHeaderBlockDocument.js';
import { ITransactionDocument } from '../../db/interfaces/ITransactionDocument.js';
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

    public abstract setStoragePointers(
        storage: Map<BitcoinAddress, Map<StoragePointer, [MemoryValue, string[]]>>,
        lastSeenAt: bigint,
    ): Promise<void>;

    public abstract hasContractAt(address: BitcoinAddress): Promise<boolean>;

    public abstract getContractAt(
        address: BitcoinAddress,
        height: bigint,
    ): Promise<ContractInformation | undefined>;

    public abstract saveTransaction(
        transaction: ITransactionDocument<OPNetTransactionTypes>,
    ): Promise<void>;

    public abstract saveTransactions(
        transaction: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void>;

    public abstract getBlockRootStates(height: bigint): Promise<BlockRootStates | undefined>;

    public abstract saveBlockHeader(blockHeader: BlockHeaderBlockDocument): Promise<void>;

    public abstract getBlockHeader(height: bigint): Promise<BlockHeaderBlockDocument | undefined>;

    public abstract getContractAtVirtualAddress(
        virtualAddress: string,
    ): Promise<ContractInformation | undefined>;

    public abstract setContractAt(contractData: ContractInformation): Promise<void>;

    public abstract prepareNewBlock(blockId: bigint): Promise<void>;

    public abstract terminateBlock(blockId: bigint): Promise<void>;

    public abstract revertChanges(blockId: bigint): Promise<void>;

    public abstract init(): Promise<void>;

    public abstract close(): Promise<void>;

    public abstract getLatestBlock(): Promise<BlockHeaderAPIBlockDocument | undefined>;

    public abstract getBlockTransactions(
        height: bigint | -1,
    ): Promise<BlockWithTransactions | undefined>;
}
