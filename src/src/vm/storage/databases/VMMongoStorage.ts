import { ConfigurableDBManager } from '@btc-vision/motoswapdb';
import { ClientSession } from 'mongodb';
import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';
import { IBtcIndexerConfig } from '../../../config/interfaces/IBtcIndexerConfig.js';
import { ContractPointerValueRepository } from '../../../db/repositories/ContractPointerValueRepository.js';
import { MemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { VMStorage } from '../VMStorage.js';

export class VMMongoStorage extends VMStorage {
    private databaseManager: ConfigurableDBManager;

    private currentSession: ClientSession | null = null;
    private repository: ContractPointerValueRepository | null = null;

    constructor(private readonly config: IBtcIndexerConfig) {
        super();

        this.databaseManager = new ConfigurableDBManager(this.config);
    }

    public async init(): Promise<void> {
        await this.connectDatabase();

        if (!this.databaseManager.db) {
            throw new Error('Database not connected');
        }

        this.repository = new ContractPointerValueRepository(this.databaseManager.db);
    }

    private async connectDatabase(): Promise<void> {
        await this.databaseManager.setup(this.config.DATABASE.DATABASE_NAME);
        await this.databaseManager.connect();
    }

    public async close(): Promise<void> {
        await this.databaseManager.close();
    }

    public async prepareNewBlock(): Promise<void> {
        if (!this.databaseManager.client) {
            throw new Error('Database not connected');
        }

        this.currentSession = this.databaseManager.client.startSession();
        this.currentSession.startTransaction();
    }

    public async terminateBlock(): Promise<void> {
        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.currentSession.commitTransaction();

        await this.terminateSession();
    }

    private async terminateSession(): Promise<void> {
        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.currentSession.endSession();

        this.currentSession = null;
    }

    public async revertChanges(): Promise<void> {
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
        setIfNotExit: boolean = true,
    ): Promise<MemoryValue | null> {
        if (setIfNotExit && defaultValue === null) {
            throw new Error('Default value buffer is required');
        }

        if (!this.repository) {
            throw new Error('Repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        this.log(
            `Getting storage for address ${address} and pointer ${pointer.toString('hex')}...`,
        );

        const value = await this.repository.getByContractAndPointer(
            address,
            pointer,
            this.currentSession,
        );

        if (setIfNotExit && value === null && defaultValue) {
            await this.setStorage(address, pointer, defaultValue);
        }

        return null;
    }

    public async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        if (!this.repository) {
            throw new Error('Repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        this.log(
            `Setting storage for address ${address} and pointer ${pointer.toString('hex')} to ${value.toString('hex')}...`,
        );

        return await this.repository.setByContractAndPointer(
            address,
            pointer,
            value,
            this.currentSession,
        );
    }
}
