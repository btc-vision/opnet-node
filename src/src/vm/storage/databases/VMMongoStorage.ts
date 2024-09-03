import { Address, BufferHelper } from '@btc-vision/bsi-binary';
import { ConfigurableDBManager, DebugLevel } from '@btc-vision/bsi-common';
import { ClientSession, TransactionOptions } from 'mongodb';
import { UTXOsOutputTransactions } from '../../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { SafeBigInt } from '../../../api/routes/safe/SafeMath.js';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { IBtcIndexerConfig } from '../../../config/interfaces/IBtcIndexerConfig.js';
import { BlockWithTransactions } from '../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { BlockRootStates } from '../../../db/interfaces/BlockRootStates.js';
import {
    BlockHeaderAPIBlockDocument,
    BlockHeaderBlockDocument,
    IBlockHeaderBlockDocument,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IReorgData, IReorgDocument } from '../../../db/interfaces/IReorgDocument.js';
import {
    ITransactionDocument,
    ITransactionDocumentBasic,
} from '../../../db/interfaces/ITransactionDocument.js';
import { IParsedBlockWitnessDocument } from '../../../db/models/IBlockWitnessDocument.js';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';
import { BlockWitnessRepository } from '../../../db/repositories/BlockWitnessRepository.js';
import { ContractPointerValueRepository } from '../../../db/repositories/ContractPointerValueRepository.js';
import { ContractRepository } from '../../../db/repositories/ContractRepository.js';
import { ReorgsRepository } from '../../../db/repositories/ReorgsRepository.js';
import { TransactionRepository } from '../../../db/repositories/TransactionRepository.js';
import { MemoryValue, ProvenMemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { VMStorage } from '../VMStorage.js';
import {
    IUsedWBTCUTXODocument,
    IWBTCUTXODocument,
    UsedUTXOToDelete,
} from '../../../db/interfaces/IWBTCUTXODocument.js';
import { IVaultDocument } from '../../../db/interfaces/IVaultDocument.js';
import { VaultRepository } from '../../../db/repositories/VaultRepository.js';
import { SelectedUTXOs, WBTCUTXORepository } from '../../../db/repositories/WBTCUTXORepository.js';
import { CompromisedTransactionRepository } from '../../../db/repositories/CompromisedTransactionRepository.js';
import { ICompromisedTransactionDocument } from '../../../db/interfaces/CompromisedTransactionDocument.js';
import { UsedWbtcUxtoRepository } from '../../../db/repositories/UsedWbtcUxtoRepository.js';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { UnspentTransactionRepository } from '../../../db/repositories/UnspentTransactionRepository.js';
import { Config } from '../../../config/Config.js';

export class VMMongoStorage extends VMStorage {
    private databaseManager: ConfigurableDBManager;

    private currentSession: ClientSession | undefined;
    private transactionSession: ClientSession | undefined;

    private saveTxSessions: ClientSession[] = [];

    private pointerRepository: ContractPointerValueRepository | undefined;
    private contractRepository: ContractRepository | undefined;
    private blockRepository: BlockRepository | undefined;
    private transactionRepository: TransactionRepository | undefined;
    private unspentTransactionRepository: UnspentTransactionRepository | undefined;
    private reorgRepository: ReorgsRepository | undefined;
    private blockWitnessRepository: BlockWitnessRepository | undefined;
    private mempoolRepository: MempoolRepository | undefined;

    private vaultRepository: VaultRepository | undefined;
    private wbtcUTXORepository: WBTCUTXORepository | undefined;
    private compromisedTransactionRepository: CompromisedTransactionRepository | undefined;
    private usedUTXOsRepository: UsedWbtcUxtoRepository | undefined;

    private cachedLatestBlock: BlockHeaderAPIBlockDocument | undefined;

    constructor(
        private readonly config: IBtcIndexerConfig,
        databaseManager?: ConfigurableDBManager,
    ) {
        super();

        this.databaseManager = databaseManager || new ConfigurableDBManager(this.config);
    }

    public async revertDataUntilBlock(blockId: bigint): Promise<void> {
        /** We must delete all the data until the blockId */
        if (!this.blockRepository) {
            throw new Error('Block header repository not initialized');
        }

        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.unspentTransactionRepository) {
            throw new Error('Unspent transaction repository not initialized');
        }

        if (!this.contractRepository) {
            throw new Error('Contract repository not initialized');
        }

        if (!this.pointerRepository) {
            throw new Error('Pointer repository not initialized');
        }

        if (!this.blockWitnessRepository) {
            throw new Error('Block witness repository not initialized');
        }

        if (!this.reorgRepository) {
            throw new Error('Reorg repository not initialized');
        }

        if (!this.vaultRepository) {
            throw new Error('Vault repository not initialized');
        }

        if (!this.wbtcUTXORepository) {
            throw new Error('WBTC UTXO repository not initialized');
        }

        if (!this.compromisedTransactionRepository) {
            throw new Error('Compromised transaction repository not initialized');
        }

        if (!this.usedUTXOsRepository) {
            throw new Error('Used UTXO repository not initialized');
        }

        await this.killAllPendingWrites();

        if (Config.DEV_MODE) {
            this.info(`Purging data until block ${blockId}`);

            this.log(`Purging transactions...`);
            await this.transactionRepository.deleteTransactionsFromBlockHeight(blockId);

            this.log(`Purging unspent transactions...`);
            await this.unspentTransactionRepository.deleteTransactionsFromBlockHeight(blockId);

            this.log(`Purging contracts...`);
            await this.contractRepository.deleteContractsFromBlockHeight(blockId);

            this.log(`Purging pointers...`);
            await this.pointerRepository.deletePointerFromBlockHeight(blockId);

            this.log(`Purging block headers...`);
            await this.blockRepository.deleteBlockHeadersFromBlockHeight(blockId);

            this.log(`Purging block witnesses...`);
            await this.blockWitnessRepository.deleteBlockWitnessesFromHeight(blockId);

            this.log(`Purging reorgs...`);
            await this.reorgRepository.deleteReorgs(blockId);

            this.log(`Purging vaults...`);
            await this.vaultRepository.deleteVaultsSeenAfter(blockId);

            this.log(`Purging WBTC UTXOs...`);
            await this.wbtcUTXORepository.deleteWBTCUTXOs(blockId);

            this.log(`Purging compromised transactions...`);
            await this.compromisedTransactionRepository.deleteCompromisedTransactions(blockId);

            this.log(`Purging used UTXOs...`);
            await this.usedUTXOsRepository.deleteOldUsedUtxos(blockId);

            this.info(`Data purged until block ${blockId}`);
        } else {
            const promises: Promise<void>[] = [
                this.transactionRepository.deleteTransactionsFromBlockHeight(blockId),
                this.unspentTransactionRepository.deleteTransactionsFromBlockHeight(blockId),
                this.contractRepository.deleteContractsFromBlockHeight(blockId),
                this.pointerRepository.deletePointerFromBlockHeight(blockId),
                this.blockRepository.deleteBlockHeadersFromBlockHeight(blockId),
                this.blockWitnessRepository.deleteBlockWitnessesFromHeight(blockId),
                this.reorgRepository.deleteReorgs(blockId),
                this.vaultRepository.deleteVaultsSeenAfter(blockId),
                this.wbtcUTXORepository.deleteWBTCUTXOs(blockId),
                this.compromisedTransactionRepository.deleteCompromisedTransactions(blockId),
                this.usedUTXOsRepository.deleteOldUsedUtxos(blockId),
            ];

            await Promise.all(promises);
        }
    }

    public async deleteUsedUtxos(UTXOs: UsedUTXOToDelete[]): Promise<void> {
        if (!this.usedUTXOsRepository) {
            throw new Error('Used UTXO repository not initialized');
        }

        await this.usedUTXOsRepository.deleteUsedUtxos(UTXOs, this.currentSession);
    }

    public async deleteOldUsedUtxos(blockHeight: bigint): Promise<void> {
        if (!this.usedUTXOsRepository) {
            throw new Error('Used UTXO repository not initialized');
        }

        await this.usedUTXOsRepository.deleteOldUsedUtxos(blockHeight, this.currentSession);
    }

    public async setUsedUtxo(usedUtxo: IUsedWBTCUTXODocument): Promise<void> {
        if (!this.usedUTXOsRepository) {
            throw new Error('Used UTXO repository not initialized');
        }

        await this.usedUTXOsRepository.setUsedUtxo(usedUtxo, this.currentSession);
    }

    public async getWitnesses(
        height: bigint | -1,
        trusted?: boolean,
        limit?: number,
        page?: number,
    ): Promise<IParsedBlockWitnessDocument[]> {
        if (!this.blockWitnessRepository) {
            throw new Error('Block witness repository not initialized');
        }

        if (height === -1 || height === -1n) {
            const lastBlock = await this.getLatestBlock();
            height = BigInt(lastBlock.height);
        }

        return await this.blockWitnessRepository.getWitnesses(height, trusted, limit, page);
    }

    /*public async awaitPendingWrites(): Promise<void> {
        if (this.blockHeightSaveLoop) clearTimeout(this.blockHeightSaveLoop);

        for (let action of this.writeTransactions.values()) {
            await Promise.all(action);
        }

        for (let session of this.waitingCommits.values()) {
            await session;
        }

        this.clearCache();

        await this.updateBlockHeight();
    }*/

    public async init(): Promise<void> {
        await this.connectDatabase();

        if (!this.databaseManager.db) {
            throw new Error('Database not connected');
        }

        this.pointerRepository = new ContractPointerValueRepository(this.databaseManager.db);
        this.contractRepository = new ContractRepository(this.databaseManager.db);
        this.blockRepository = new BlockRepository(this.databaseManager.db);
        this.transactionRepository = new TransactionRepository(this.databaseManager.db);
        this.unspentTransactionRepository = new UnspentTransactionRepository(
            this.databaseManager.db,
        );

        this.reorgRepository = new ReorgsRepository(this.databaseManager.db);
        this.blockWitnessRepository = new BlockWitnessRepository(this.databaseManager.db);
        this.vaultRepository = new VaultRepository(this.databaseManager.db);
        this.wbtcUTXORepository = new WBTCUTXORepository(this.databaseManager.db);
        this.compromisedTransactionRepository = new CompromisedTransactionRepository(
            this.databaseManager.db,
        );

        this.mempoolRepository = new MempoolRepository(this.databaseManager.db);

        this.usedUTXOsRepository = new UsedWbtcUxtoRepository(this.databaseManager.db);
    }

    public async purgePointers(block: bigint): Promise<void> {
        if (!this.pointerRepository) {
            throw new Error('Pointer repository not initialized');
        }

        await this.pointerRepository.deletePointerFromBlockHeight(block);
    }

    public async deleteTransactionsById(ids: string[]): Promise<void> {
        if (!this.mempoolRepository) {
            throw `Mempool repository not defined.`;
        }

        await this.mempoolRepository.deleteTransactionsById(ids);
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

    public async getReorgs(
        fromBlock: bigint,
        toBlock: bigint,
    ): Promise<IReorgDocument[] | undefined> {
        if (!this.reorgRepository) {
            throw new Error('Reorg repository not initialized');
        }

        return await this.reorgRepository.getReorgs(fromBlock, toBlock);
    }

    public async setReorg(reorg: IReorgData): Promise<void> {
        if (!this.reorgRepository) {
            throw new Error('Reorg repository not initialized');
        }

        await this.reorgRepository.setReorg(reorg);
    }

    public async getBlockTransactions(
        height: SafeBigInt = -1,
        hash?: string,
        includeTransactions?: boolean,
    ): Promise<BlockWithTransactions | undefined> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        let block: IBlockHeaderBlockDocument | undefined;
        if (hash) {
            block = await this.blockRepository.getBlockByHash(hash, this.currentSession);
        } else {
            block =
                height === -1
                    ? await this.blockRepository.getLatestBlock()
                    : await this.blockRepository.getBlockHeader(height, this.currentSession);
        }

        if (!block) {
            return undefined;
        }

        const transactions =
            includeTransactions === true
                ? await this.transactionRepository.getTransactionsByBlockHash(block.height)
                : [];

        return {
            block: this.convertBlockHeaderToBlockHeaderDocument(block),
            transactions,
        };
    }

    public async getTransactionByHash(
        hash: string,
    ): Promise<ITransactionDocument<OPNetTransactionTypes> | undefined> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        return await this.transactionRepository.getTransactionByHash(hash);
    }

    public async close(): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Closing database');
        }

        await this.databaseManager.close();
    }

    public async prepareNewBlock(_blockId: bigint): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Preparing new block');
        }

        if (this.currentSession || this.transactionSession) {
            throw new Error('Session already started');
        }

        const sessions = await Promise.all([
            this.databaseManager.startSession(),
            this.databaseManager.startSession(),
        ]);

        this.currentSession = sessions[0];
        this.transactionSession = sessions[1];

        this.currentSession.startTransaction(this.getTransactionOptions());
        this.transactionSession.startTransaction(this.getTransactionOptions());
    }

    public async terminateBlock(): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating block');
        }

        if (!this.currentSession || !this.transactionSession) {
            throw new Error('Session not started');
        }

        await Promise.all([
            this.currentSession.commitTransaction(),
            this.transactionSession.commitTransaction(),
            ...this.saveTxSessions.map((session) => session.commitTransaction()),
        ]);

        await this.terminateSession();
    }

    public async revertChanges(_blockId: bigint): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Reverting changes');
        }

        if (!this.currentSession || !this.transactionSession) {
            throw new Error('Session not started');
        }

        if (this.currentSession.hasEnded) {
            throw new Error('Current session has ended');
        }

        await Promise.all([
            this.currentSession.abortTransaction(),
            this.transactionSession.abortTransaction(),
            ...this.saveTxSessions.map((session) => session.abortTransaction()),
        ]);

        await this.terminateSession();
    }

    public async getStorage(
        address: Address,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = false,
        height: bigint,
    ): Promise<ProvenMemoryValue | null> {
        if (setIfNotExit && defaultValue === null) {
            throw new Error('Default value buffer is required');
        }

        if (!this.pointerRepository) {
            throw new Error('Repository not initialized');
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

    public async insertUTXOs(
        blockHeight: bigint,
        transactions: ITransactionDocumentBasic<OPNetTransactionTypes>[],
    ): Promise<void> {
        if (!this.unspentTransactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        await this.unspentTransactionRepository.insertTransactions(
            blockHeight,
            transactions,
            this.transactionSession,
        );
    }

    /*public async saveTransaction(
        transaction: ITransactionDocument<OPNetTransactionTypes>,
    ): Promise<void> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.transactionSession) {
            throw new Error('Session not started');
        }

        await this.transactionRepository.saveTransaction(transaction, this.transactionSession);
    }*/

    public async setStorage(
        address: Address,
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

    /*public saveTransactions(
        blockHeight: bigint,
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): void {
        if (!this.transactionRepository || !this.unspentTransactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.transactionSession || !this.currentSession) {
            throw new Error('Session not started');
        }

        const promise = this.transactionRepository.saveTransactions(
            transactions,
            this.transactionSession,
        );

        const data = this.writeTransactions.get(blockHeight) || [];
        data.push(promise);

        this.writeTransactions.set(blockHeight, data);
    }*/

    public async setStoragePointers(
        storage: Map<Address, Map<StoragePointer, [MemoryValue, string[]]>>,
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
        contractAddress: Address,
        height?: bigint,
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

    public async getContractAddressAt(
        contractAddress: Address,
        height?: bigint,
    ): Promise<Address | undefined> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.contractRepository.getContractAddressAt(
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

    public async hasContractAt(contractAddress: Address): Promise<boolean> {
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

    public async getUTXOs(
        address: Address,
        optimize: boolean = false,
    ): Promise<UTXOsOutputTransactions> {
        if (!this.unspentTransactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        return await this.unspentTransactionRepository.getWalletUnspentUTXOS(address, optimize);
    }

    public async setWBTCUTXO(wbtcUTXO: IWBTCUTXODocument): Promise<void> {
        if (!this.wbtcUTXORepository) {
            throw new Error('WBTC UTXO repository not initialized');
        }

        await this.wbtcUTXORepository.setWBTCUTXO(wbtcUTXO);
    }

    public async setWBTCUTXOs(wbtcUTXOs: IWBTCUTXODocument[]): Promise<void> {
        if (!this.wbtcUTXORepository) {
            throw new Error('WBTC UTXO repository not initialized');
        }

        await this.wbtcUTXORepository.setWBTCUTXOs(wbtcUTXOs);
    }

    public async setVault(vault: IVaultDocument): Promise<void> {
        if (!this.vaultRepository) {
            throw new Error('Vault repository not initialized');
        }

        await this.vaultRepository.setVault(vault);
    }

    public async getWBTCUTXOs(
        requestedAmount: bigint,
        consolidationAcceptance: bigint,
    ): Promise<SelectedUTXOs | undefined> {
        if (!this.wbtcUTXORepository) {
            throw new Error('WBTC UTXO repository not initialized');
        }

        return await this.wbtcUTXORepository.queryVaultsUTXOs(
            requestedAmount,
            consolidationAcceptance,
        );
    }

    public async saveCompromisedTransactions(
        transactions: ICompromisedTransactionDocument[],
    ): Promise<void> {
        if (!this.currentSession) {
            throw new Error('Current session not started');
        }

        if (!this.compromisedTransactionRepository) {
            throw new Error('Compromised transaction repository not initialized');
        }

        await this.compromisedTransactionRepository.saveCompromisedTransactions(
            transactions,
            this.currentSession,
        );
    }

    public async setSpentWBTCUTXOs(utxos: UsedUTXOToDelete[], height: bigint): Promise<void> {
        if (!this.currentSession) {
            throw new Error('Current session not started');
        }

        if (!this.wbtcUTXORepository) {
            throw new Error('WBTC UTXO repository not initialized');
        }

        await this.wbtcUTXORepository.setSpentWBTC_UTXOs(utxos, height, this.currentSession);
    }

    public async deleteOldUTXOs(height: bigint): Promise<void> {
        if (!this.currentSession) {
            throw new Error('Current session not started');
        }

        if (!this.wbtcUTXORepository) {
            throw new Error('WBTC UTXO repository not initialized');
        }

        await this.wbtcUTXORepository.deleteOldUTXOs(height, this.currentSession);
    }

    public async getVault(vault: Address): Promise<IVaultDocument | undefined> {
        if (!this.vaultRepository) {
            throw new Error('Vault repository not initialized');
        }

        return await this.vaultRepository.getVault(vault);
    }

    public async getBalanceOf(
        address: Address,
        filterOrdinals: boolean,
    ): Promise<bigint | undefined> {
        if (!this.unspentTransactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        return await this.unspentTransactionRepository.getBalanceOf(address, filterOrdinals);
    }

    public async killAllPendingWrites(): Promise<void> {
        if (!this.databaseManager.db) {
            throw new Error('Database not connected');
        }

        await this.databaseManager.db.command({
            killAllSessions: [],
        });
    }

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        const chunks = this.chunkArray(transactions, 100);
        const promises = chunks.map(async (chunk) => {
            if (!this.transactionRepository) {
                throw new Error('Transaction repository not initialized');
            }

            let session = await this.databaseManager.startSession();
            session.startTransaction(this.getTransactionOptions());

            this.saveTxSessions.push(session);

            try {
                await this.transactionRepository.saveTransactions(chunk, session);
            } catch (e) {
                throw e;
            }
        });

        await Promise.all(promises);
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        return array.reduce((acc, _, i) => {
            if (i % size === 0) {
                acc.push(array.slice(i, i + size));
            }

            return acc;
        }, [] as T[][]);
    }

    private getTransactionOptions(): TransactionOptions {
        return {
            maxCommitTimeMS: 29 * 60000,
        };
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
        await this.databaseManager.setup();
        await this.databaseManager.connect();
    }

    private async terminateSession(): Promise<void> {
        if (!this.currentSession || !this.transactionSession) {
            throw new Error('Session not started');
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating session');
        }

        const promiseTerminate: Promise<void>[] = [
            this.currentSession.endSession(),
            this.transactionSession.endSession(),
            ...this.saveTxSessions.map((session) => session.endSession()),
        ];

        await Promise.all(promiseTerminate);

        this.currentSession = undefined;
        this.transactionSession = undefined;
        this.saveTxSessions = [];
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
