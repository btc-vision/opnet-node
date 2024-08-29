import { Logger } from '@btc-vision/bsi-common';
import { UTXOsOutputTransactions } from '../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { BlockWithTransactions } from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { BlockRootStates } from '../../db/interfaces/BlockRootStates.js';
import {
    BlockHeaderAPIBlockDocument,
    BlockHeaderBlockDocument,
} from '../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IReorgData, IReorgDocument } from '../../db/interfaces/IReorgDocument.js';
import {
    ITransactionDocument,
    ITransactionDocumentBasic,
} from '../../db/interfaces/ITransactionDocument.js';
import { IParsedBlockWitnessDocument } from '../../db/models/IBlockWitnessDocument.js';
import { IVMStorageMethod } from './interfaces/IVMStorageMethod.js';
import { MemoryValue, ProvenMemoryValue } from './types/MemoryValue.js';
import { StoragePointer } from './types/StoragePointer.js';
import { Address } from '@btc-vision/bsi-binary';
import {
    IUsedWBTCUTXODocument,
    IWBTCUTXODocument,
    UsedUTXOToDelete,
} from '../../db/interfaces/IWBTCUTXODocument.js';
import { IVaultDocument } from '../../db/interfaces/IVaultDocument.js';
import { SelectedUTXOs } from '../../db/repositories/WBTCUTXORepository.js';
import { ICompromisedTransactionDocument } from '../../db/interfaces/CompromisedTransactionDocument.js';

export abstract class VMStorage extends Logger implements IVMStorageMethod {
    public readonly logColor: string = '#ff00ff';

    protected constructor() {
        super();
    }

    public abstract revertDataUntilBlock(height: bigint): Promise<void>;

    public abstract getWitnesses(
        height: bigint | -1,
        trusted?: boolean,
        limit?: number,
        page?: number,
    ): Promise<IParsedBlockWitnessDocument[]>;

    public abstract getStorage(
        address: Address,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null,
        setIfNotExit: boolean,
        height?: bigint,
    ): Promise<ProvenMemoryValue | null>;

    public abstract setStorage(
        address: Address,
        pointer: StoragePointer,
        value: MemoryValue,
        proofs: string[],
        lastSeenAt: bigint,
    ): Promise<void>;

    public abstract setStoragePointers(
        storage: Map<Address, Map<StoragePointer, [MemoryValue, string[]]>>,
        lastSeenAt: bigint,
    ): Promise<void>;

    public abstract hasContractAt(address: Address): Promise<boolean>;

    public abstract getContractAt(
        address: Address,
        height?: bigint,
    ): Promise<ContractInformation | undefined>;

    public abstract getContractAddressAt(
        address: Address,
        height?: bigint,
    ): Promise<Address | undefined>;

    public abstract getTransactionByHash(
        hash: string,
    ): Promise<ITransactionDocument<OPNetTransactionTypes> | undefined>;

    /*public abstract saveTransactions(
        blockHeight: bigint,
        transaction: ITransactionDocument<OPNetTransactionTypes>[],
    ): void;*/

    public abstract insertUTXOs(
        blockHeight: bigint,
        transaction: ITransactionDocumentBasic<OPNetTransactionTypes>[],
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
        height?: bigint | -1,
        hash?: string,
        includeTransactions?: boolean,
    ): Promise<BlockWithTransactions | undefined>;

    public abstract getUTXOs(
        address: string,
        optimize: boolean,
    ): Promise<UTXOsOutputTransactions | undefined>;

    public abstract getBalanceOf(
        address: string,
        filterOrdinals: boolean,
    ): Promise<bigint | undefined>;

    public abstract getReorgs(
        fromBlock?: bigint,
        toBlock?: bigint,
    ): Promise<IReorgDocument[] | undefined>;

    public abstract setReorg(reorgData: IReorgData): Promise<void>;

    public abstract killAllPendingWrites(): Promise<void>;

    public abstract setWBTCUTXO(wbtcUTXO: IWBTCUTXODocument): Promise<void>;

    public abstract setVault(vault: IVaultDocument): Promise<void>;

    public abstract getWBTCUTXOs(
        requestedAmount: bigint,
        consolidationAcceptance: bigint,
    ): Promise<SelectedUTXOs | undefined>;

    public abstract getVault(vault: string): Promise<IVaultDocument | undefined>;

    public abstract saveCompromisedTransactions(
        compromisedTransactions: ICompromisedTransactionDocument[],
    ): Promise<void>;

    public abstract setSpentWBTCUTXOs(utxos: UsedUTXOToDelete[], height: bigint): Promise<void>;

    public abstract deleteOldUTXOs(height: bigint): Promise<void>;

    public abstract deleteUsedUtxos(utxos: UsedUTXOToDelete[]): Promise<void>;

    public abstract deleteOldUsedUtxos(height: bigint): Promise<void>;

    public abstract setUsedUtxo(usedUtxo: IUsedWBTCUTXODocument): Promise<void>;

    public abstract setWBTCUTXOs(wbtcUTXOs: IWBTCUTXODocument[]): Promise<void>;

    public abstract deleteTransactionsById(transactions: string[]): Promise<void>;

    public abstract purgePointers(block: bigint): Promise<void>;
}
