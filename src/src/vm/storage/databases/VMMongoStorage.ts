import { BufferHelper } from '@btc-vision/bsi-binary';
import { ConfigurableDBManager, DebugLevel } from '@btc-vision/bsi-common';
import { ClientSession } from 'mongodb';
import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { Config } from '../../../config/Config.js';
import { IBtcIndexerConfig } from '../../../config/interfaces/IBtcIndexerConfig.js';
import { BlockWithTransactions } from '../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { BlockRootStates } from '../../../db/interfaces/BlockRootStates.js';
import {
    BlockHeaderAPIBlockDocument,
    BlockHeaderBlockDocument,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { ITransactionDocument } from '../../../db/interfaces/ITransactionDocument.js';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';
import { ContractPointerValueRepository } from '../../../db/repositories/ContractPointerValueRepository.js';
import { ContractRepository } from '../../../db/repositories/ContractRepository.js';
import { TransactionRepository } from '../../../db/repositories/TransactionRepository.js';
import { MemoryValue, ProvenMemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { VMStorage } from '../VMStorage.js';

export class VMMongoStorage extends VMStorage {
    private databaseManager: ConfigurableDBManager;

    private currentSession: ClientSession | undefined;
    private transactionSession: ClientSession | undefined;

    private pointerRepository: ContractPointerValueRepository | undefined;
    private contractRepository: ContractRepository | undefined;
    private blockRepository: BlockRepository | undefined;
    private transactionRepository: TransactionRepository | undefined;

    private cachedLatestBlock: BlockHeaderAPIBlockDocument | undefined;

    constructor(private readonly config: IBtcIndexerConfig) {
        super();

        this.startCache();

        this.databaseManager = new ConfigurableDBManager(this.config);
    }

    public async init(): Promise<void> {
        await this.connectDatabase();

        if (!this.databaseManager.db) {
            throw new Error('Database not connected');
        }

        this.pointerRepository = new ContractPointerValueRepository(this.databaseManager.db);
        this.contractRepository = new ContractRepository(this.databaseManager.db);
        this.blockRepository = new BlockRepository(this.databaseManager.db);
        this.transactionRepository = new TransactionRepository(this.databaseManager.db);
    }

    public async getLatestBlock(): Promise<BlockHeaderAPIBlockDocument> {
        if (!this.blockRepository) {
            throw new Error('Block header repository not initialized');
        }

        if (this.cachedLatestBlock) {
            return this.cachedLatestBlock;
        }

        const latestBlock = await this.blockRepository.getLatestBlock();
        if (!latestBlock) {
            throw new Error('No latest block found');
        }

        this.cachedLatestBlock = this.convertBlockHeaderToBlockHeaderDocument(latestBlock);

        return this.cachedLatestBlock;
    }

    public async getBlockTransactions(
        height: -1 | bigint = -1,
    ): Promise<BlockWithTransactions | undefined> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        let block =
            height === -1
                ? await this.blockRepository.getLatestBlock()
                : await this.blockRepository.getBlockHeader(height, this.currentSession);

        if (!block) {
            return undefined;
        }

        const transactions = await this.transactionRepository.getTransactionsByBlockHash(
            block.height,
            this.currentSession,
        );

        return {
            block: this.convertBlockHeaderToBlockHeaderDocument(block),
            transactions,
        };
    }

    public async close(): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Closing database');
        }

        await this.databaseManager.close();
    }

    public async prepareNewBlock(): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Preparing new block');
        }

        if (this.currentSession) {
            throw new Error('Session already started');
        }

        if (this.transactionSession) {
            throw new Error('Transaction session already started');
        }

        const sessions = [this.databaseManager.startSession(), this.databaseManager.startSession()];

        this.currentSession = await sessions[0];
        this.transactionSession = await sessions[1];

        this.currentSession.startTransaction();
        this.transactionSession.startTransaction();
    }

    public async terminateBlock(): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating block');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        if (!this.transactionSession) {
            throw new Error('Transaction session not started');
        }

        const commitPromises: Promise<void>[] = [
            this.currentSession.commitTransaction(),
            this.transactionSession.commitTransaction(),
        ];

        await Promise.all(commitPromises);

        await this.terminateSession();
    }

    public async revertChanges(): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Reverting changes');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        if (!this.transactionSession) {
            throw new Error('Transaction session not started');
        }

        await this.currentSession.abortTransaction();
        await this.transactionSession.abortTransaction();

        await this.terminateSession();
    }

    public async getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = false,
        height?: bigint,
    ): Promise<ProvenMemoryValue | null> {
        if (setIfNotExit && defaultValue === null) {
            throw new Error('Default value buffer is required');
        }

        if (!this.pointerRepository) {
            throw new Error('Repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        const value = await this.pointerRepository.getByContractAndPointer(
            address,
            pointer,
            height,
            //this.currentSession,
        );

        if (Buffer.isBuffer(value)) {
            throw new Error('The value returned was not an Uint8Array!');
        }

        if (setIfNotExit && !value && defaultValue) {
            return {
                value: this.addBytes(defaultValue),
                proofs: [],
                lastSeenAt: BigInt(0),
            };
        }

        if (!value) {
            return null;
        }

        return {
            value: value.value,
            proofs: value.proofs,
            lastSeenAt: value.lastSeenAt,
        };
    }

    public async saveTransaction(
        transaction: ITransactionDocument<OPNetTransactionTypes>,
    ): Promise<void> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.transactionSession) {
            throw new Error('Session not started');
        }

        await this.transactionRepository.saveTransaction(transaction, this.transactionSession);
    }

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.transactionSession) {
            throw new Error('Session not started');
        }

        await this.transactionRepository.saveTransactions(transactions, this.transactionSession);
    }

    public async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
        proofs: string[],
        lastSeenAt: bigint,
    ): Promise<void> {
        if (!this.pointerRepository) {
            throw new Error('Repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.pointerRepository.setByContractAndPointer(
            address,
            pointer,
            value,
            proofs,
            lastSeenAt,
            this.currentSession,
        );
    }

    public async setStoragePointers(
        storage: Map<BitcoinAddress, Map<StoragePointer, [MemoryValue, string[]]>>,
        lastSeenAt: bigint,
    ): Promise<void> {
        if (!this.pointerRepository) {
            throw new Error('Repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.pointerRepository.setStoragePointers(storage, lastSeenAt, this.currentSession);
    }

    public async getBlockRootStates(height: bigint): Promise<BlockRootStates | undefined> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.blockRepository.getBlockRootStates(height, this.currentSession);
    }

    public async setContractAt(contractData: ContractInformation): Promise<void> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.contractRepository.setContract(contractData, this.currentSession);
    }

    public async getContractAt(
        contractAddress: BitcoinAddress,
        height: bigint,
    ): Promise<ContractInformation | undefined> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.contractRepository.getContract(
            contractAddress,
            height,
            this.currentSession,
        );
    }

    public async saveBlockHeader(blockHeader: BlockHeaderBlockDocument): Promise<void> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        await this.blockRepository.saveBlockHeader(blockHeader, this.currentSession);
    }

    public async getContractAtVirtualAddress(
        virtualAddress: string,
    ): Promise<ContractInformation | undefined> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.contractRepository.getContractAtVirtualAddress(virtualAddress);
    }

    public async hasContractAt(contractAddress: BitcoinAddress): Promise<boolean> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.contractRepository.hasContract(contractAddress);
    }

    public async getBlockHeader(height: bigint): Promise<BlockHeaderBlockDocument | undefined> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.blockRepository.getBlockHeader(height);
    }

    private startCache(): void {
        setInterval(() => {
            this.clearCache();
        }, 1000);
    }

    private clearCache(): void {
        this.cachedLatestBlock = undefined;
    }

    private convertBlockHeaderToBlockHeaderDocument(
        blockHeader: BlockHeaderBlockDocument,
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
        };
    }

    private async connectDatabase(): Promise<void> {
        await this.databaseManager.setup(this.config.DATABASE.DATABASE_NAME);
        await this.databaseManager.connect();
    }

    private async terminateSession(): Promise<void> {
        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        if (!this.transactionSession) {
            throw new Error('Transaction session not started');
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating session');
        }

        const promiseTerminate: Promise<void>[] = [
            this.currentSession.endSession(),
            this.transactionSession.endSession(),
        ];

        await Promise.all(promiseTerminate);

        this.currentSession = undefined;
        this.transactionSession = undefined;
    }

    private addBytes(value: MemoryValue): Uint8Array {
        if (value.byteLength > BufferHelper.EXPECTED_BUFFER_LENGTH) {
            throw new Error(
                `Invalid value length ${value.byteLength} for storage. Expected ${BufferHelper.EXPECTED_BUFFER_LENGTH} bytes.`,
            );
        }

        if (value.byteLength === BufferHelper.EXPECTED_BUFFER_LENGTH) {
            return value;
        }

        const length = Math.max(value.byteLength, BufferHelper.EXPECTED_BUFFER_LENGTH);
        const buffer = new Uint8Array(length);

        if (value.byteLength) buffer.set(value, 0);

        return buffer;
    }
}
