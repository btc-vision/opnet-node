import { BufferHelper } from '@btc-vision/bsi-binary';
import { ConfigurableDBManager, DebugLevel } from '@btc-vision/bsi-common';
import { ClientSession } from 'mongodb';
import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { Config } from '../../../config/Config.js';
import { IBtcIndexerConfig } from '../../../config/interfaces/IBtcIndexerConfig.js';
import { BlockRootStates } from '../../../db/interfaces/BlockRootStates.js';
import { BlockHeaderBlockDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
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
    private pointerRepository: ContractPointerValueRepository | undefined;
    private contractRepository: ContractRepository | undefined;
    private blockRepository: BlockRepository | undefined;
    private transactionRepository: TransactionRepository | undefined;

    constructor(private readonly config: IBtcIndexerConfig) {
        super();

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

        this.currentSession = await this.databaseManager.startSession();
        this.currentSession.startTransaction();
    }

    public async terminateBlock(): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating block');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.currentSession.commitTransaction();

        await this.terminateSession();
    }

    public async revertChanges(): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Reverting changes');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.currentSession.abortTransaction();

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
            this.currentSession,
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

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.transactionRepository.saveTransaction(transaction, this.currentSession);
    }

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.transactionRepository.saveTransactions(transactions, this.currentSession);
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
    ): Promise<ContractInformation | undefined> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.contractRepository.getContract(contractAddress, this.currentSession);
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

        return await this.blockRepository.getBlockHeader(height, this.currentSession);
    }

    private async connectDatabase(): Promise<void> {
        await this.databaseManager.setup(this.config.DATABASE.DATABASE_NAME);
        await this.databaseManager.connect();
    }

    private async terminateSession(): Promise<void> {
        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating session');
        }

        await this.currentSession.endSession();

        this.currentSession = undefined;
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
