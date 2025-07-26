import { Logger } from '@btc-vision/bsi-common';
import { UTXOsOutputTransactions } from '../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { BlockWithTransactions } from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import {
    BlockHeaderAPIBlockDocument,
    BlockHeaderDocument,
} from '../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IReorgData, IReorgDocument } from '../../db/interfaces/IReorgDocument.js';
import { ITransactionDocument } from '../../db/interfaces/ITransactionDocument.js';
import { IParsedBlockWitnessDocument } from '../../db/models/IBlockWitnessDocument.js';
import { MemoryValue, ProvenMemoryValue, ProvenPointers } from './types/MemoryValue.js';
import { StoragePointer } from './types/StoragePointer.js';
import { BlockchainInfoRepository } from '../../db/repositories/BlockchainInfoRepository.js';
import { IPublicKeyInfoResult } from '../../api/json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';
import { Address, AddressMap } from '@btc-vision/transaction';
import { IEpochDocument } from '../../db/documents/interfaces/IEpochDocument.js';
import { IEpochSubmissionsDocument } from '../../db/documents/interfaces/IEpochSubmissionsDocument.js';
import { Binary } from 'mongodb';
import { SafeBigInt } from '../../api/routes/safe/BlockParamsConverter.js';
import {
    ITargetEpochDocument,
    PendingTargetEpoch,
} from '../../db/documents/interfaces/ITargetEpochDocument.js';

export abstract class VMStorage extends Logger {
    public readonly logColor: string = '#ff00ff';

    protected constructor() {
        super();
    }

    public abstract get blockchainRepository(): BlockchainInfoRepository;

    public convertBlockHeaderToBlockHeaderDocument(
        blockHeader: BlockHeaderDocument,
    ): BlockHeaderAPIBlockDocument {
        return {
            hash: blockHeader.hash,
            height: blockHeader.height.toString(),
            time: blockHeader.time.getTime(),
            version: blockHeader.version,
            bits: blockHeader.bits,
            nonce: blockHeader.nonce,
            previousBlockHash: blockHeader.previousBlockHash,
            merkleRoot: blockHeader.merkleRoot,
            txCount: blockHeader.txCount,
            size: blockHeader.size,
            weight: blockHeader.weight,
            strippedSize: blockHeader.strippedSize,
            storageRoot: blockHeader.storageRoot,
            receiptRoot: blockHeader.receiptRoot,
            checksumProofs: blockHeader.checksumProofs,
            medianTime: blockHeader.medianTime.getTime(),
            previousBlockChecksum: blockHeader.previousBlockChecksum,
            checksumRoot: blockHeader.checksumRoot,
            ema: blockHeader.ema.toString(),
            baseGas: blockHeader.baseGas.toString(),
            gasUsed: blockHeader.gasUsed.toString(),
        };
    }

    public abstract revertDataUntilBlock(height: bigint): Promise<void>;

    public abstract getAddressOrPublicKeysInformation(
        publicKeys: string[],
    ): Promise<IPublicKeyInfoResult>;

    public abstract close(): Promise<void>;

    public abstract getWitnesses(
        height: bigint | -1,
        trusted?: boolean,
        limit?: number,
        page?: number,
    ): Promise<IParsedBlockWitnessDocument[]>;

    public abstract getWitnessesForEpoch(
        startBlock: bigint,
        endBlock: bigint,
        limitPerBlock: number,
    ): Promise<IParsedBlockWitnessDocument[]>;

    public abstract getStorage(
        address: Address,
        pointer: StoragePointer,
        height?: bigint,
    ): Promise<ProvenMemoryValue | null>;

    public abstract getStorageMultiple(
        pointers: AddressMap<Uint8Array[]>,
        height?: bigint,
    ): Promise<ProvenPointers | null>;

    public abstract setStoragePointers(
        storage: AddressMap<Map<StoragePointer, [MemoryValue, string[]]>>,
        lastSeenAt: bigint,
    ): Promise<void>;

    public abstract getContractAt(
        address: string,
        height?: bigint,
    ): Promise<ContractInformation | undefined>;

    public abstract getContractAddressAt(
        address: string,
        height?: bigint,
    ): Promise<Address | undefined>;

    public abstract getTransactionByHash(
        hash: string,
    ): Promise<ITransactionDocument<OPNetTransactionTypes> | undefined>;

    public abstract saveTransactions(
        transaction: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void>;

    public abstract saveBlockHeader(blockHeader: BlockHeaderDocument): Promise<void>;

    public abstract getBlockHeader(height: bigint): Promise<BlockHeaderDocument | undefined>;

    public abstract getContractFromTweakedPubKey(
        tweakedPublicKey: string,
    ): Promise<ContractInformation | undefined>;

    public abstract setContractAt(contractData: ContractInformation): Promise<void>;

    public abstract init(): Promise<void>;

    public abstract getLatestBlock(): Promise<BlockHeaderAPIBlockDocument | undefined>;

    public abstract addTweakedPublicKey(buffer: Buffer): Promise<void>;

    public abstract getBlockTransactions(
        height?: bigint | -1,
        hash?: string,
        includeTransactions?: boolean,
        checksum?: boolean,
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

    public abstract deleteTransactionsById(transactions: string[]): Promise<void>;

    public abstract getPreimage(blockHeight: bigint): Promise<string>;

    // Epoch-related abstract methods

    /**
     * Get the latest epoch
     */
    public abstract getLatestEpoch(): Promise<IEpochDocument | undefined>;

    /**
     * Get epoch by epoch number
     */
    public abstract getEpochByNumber(epochNumber: SafeBigInt): Promise<IEpochDocument | undefined>;

    /**
     * Get epoch by epoch hash
     */
    public abstract getEpochByHash(epochHash: Buffer | Binary): Promise<IEpochDocument | undefined>;

    /**
     * Get epoch by block height (find which epoch contains this block)
     */
    public abstract getEpochByBlockHeight(blockHeight: bigint): Promise<IEpochDocument | undefined>;

    /**
     * Get active epoch (where endBlock is -1)
     */
    public abstract getActiveEpoch(): Promise<IEpochDocument | undefined>;

    /**
     * Get epochs by proposer public key
     */
    public abstract getEpochsByProposer(
        proposerPublicKey: Buffer | Binary,
    ): Promise<IEpochDocument[]>;

    /**
     * Get epochs by target hash
     */
    public abstract getEpochsByTargetHash(targetHash: Buffer | Binary): Promise<IEpochDocument[]>;

    /**
     * Save or update an epoch
     */
    public abstract saveEpoch(epoch: IEpochDocument): Promise<void>;

    /**
     * Update epoch end block
     */
    public abstract updateEpochEndBlock(epochNumber: bigint, endBlock: bigint): Promise<void>;

    /**
     * Delete epochs from a specific bitcoin block number onwards
     */
    public abstract deleteEpochFromBitcoinBlockNumber(bitcoinBlockNumber: bigint): Promise<void>;

    /**
     * Get all submissions for a specific epoch number
     */
    public abstract getSubmissionsByEpochNumber(
        epochNumber: bigint,
    ): Promise<IEpochSubmissionsDocument[]>;

    /**
     * Get submission by transaction hash
     */
    public abstract getSubmissionByTxHash(
        txHash: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument | undefined>;

    /**
     * Get submission by transaction ID
     */
    public abstract getSubmissionByTxId(
        txId: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument | undefined>;

    /**
     * Get submissions accepted within a block range
     */
    public abstract getSubmissionsInBlockRange(
        startBlock: bigint,
        endBlock: bigint,
    ): Promise<IEpochSubmissionsDocument[]>;

    /**
     * Get submissions by proposer public key
     */
    public abstract getSubmissionsByProposer(
        proposerPublicKey: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument[]>;

    /**
     * Get pending submissions (not yet accepted)
     */
    public abstract getPendingSubmissions(fromBlock: bigint): Promise<IEpochSubmissionsDocument[]>;

    /**
     * Get submissions by submission hash
     */
    public abstract getSubmissionByHash(
        submissionHash: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument | undefined>;

    /**
     * Check if a submission exists
     */
    public abstract submissionExists(
        publicKey: Buffer | Binary,
        salt: Buffer | Binary,
        epochNumber: bigint,
    ): Promise<boolean>;

    public abstract targetEpochExists(
        epochNumber: bigint,
        salt: Buffer | Binary,
        publicKey: Address | Buffer | Binary,
    ): Promise<boolean>;

    public abstract getBestTargetEpoch(epochNumber: bigint): Promise<ITargetEpochDocument | null>;

    public abstract saveTargetEpoch(targetEpoch: ITargetEpochDocument): Promise<void>;

    public abstract deleteOldTargetEpochs(epochNumber: bigint): Promise<void>;

    public abstract getPendingEpochTarget(blockNumber: bigint): Promise<PendingTargetEpoch>;
}
