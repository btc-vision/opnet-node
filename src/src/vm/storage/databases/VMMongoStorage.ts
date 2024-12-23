import { Address, AddressMap, BufferHelper } from '@btc-vision/transaction';
import { ConfigurableDBManager, DebugLevel } from '@btc-vision/bsi-common';
import { ClientSession, TransactionOptions } from 'mongodb';
import { UTXOsOutputTransactions } from '../../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { SafeBigInt } from '../../../api/routes/safe/BlockParamsConverter.js';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { IBtcIndexerConfig } from '../../../config/interfaces/IBtcIndexerConfig.js';
import { BlockWithTransactions } from '../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import {
    BlockHeaderAPIBlockDocument,
    BlockHeaderDocument,
    IBlockHeaderBlockDocument,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IReorgData, IReorgDocument } from '../../../db/interfaces/IReorgDocument.js';
import { ITransactionDocument } from '../../../db/interfaces/ITransactionDocument.js';
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
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { UnspentTransactionRepository } from '../../../db/repositories/UnspentTransactionRepository.js';
import { Config } from '../../../config/Config.js';
import { CurrentOpOutput, OperationDetails } from '../interfaces/StorageInterfaces.js';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { PublicKeysRepository } from '../../../db/repositories/PublicKeysRepository.js';
import { IPublicKeyInfoResult } from '../../../api/json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';

export class VMMongoStorage extends VMStorage {
    private databaseManager: ConfigurableDBManager;

    private currentSession: ClientSession | undefined;
    private utxoSession: ClientSession | undefined;
    private lastUtxoSession: ClientSession | undefined | null;
    private commitUTXOPromise: Promise<void> | undefined;

    private saveTxSessions: ClientSession[] = [];

    private pointerRepository: ContractPointerValueRepository | undefined;
    private contractRepository: ContractRepository | undefined;
    private blockRepository: BlockRepository | undefined;
    private transactionRepository: TransactionRepository | undefined;
    private unspentTransactionRepository: UnspentTransactionRepository | undefined;
    private reorgRepository: ReorgsRepository | undefined;
    private blockWitnessRepository: BlockWitnessRepository | undefined;
    private mempoolRepository: MempoolRepository | undefined;

    private blockchainInfoRepository: BlockchainInfoRepository | undefined;
    private publicKeysRepository: PublicKeysRepository | undefined;
    private initialized: boolean = false;

    constructor(
        private readonly config: IBtcIndexerConfig,
        databaseManager?: ConfigurableDBManager,
    ) {
        super();

        this.databaseManager = databaseManager || new ConfigurableDBManager(this.config);
    }

    public get blockchainRepository(): BlockchainInfoRepository {
        if (!this.blockchainInfoRepository) {
            throw new Error('Blockchain info repository not initialized');
        }

        return this.blockchainInfoRepository;
    }

    public async revertDataUntilBlock(blockId: bigint): Promise<void> {
        this.warn(`REVERT DATA UNTIL BLOCK ${blockId}`);

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

        if (!this.mempoolRepository) {
            throw new Error('Mempool repository not initialized');
        }

        await this.killAllPendingWrites();

        if (Config.DEV_MODE) {
            this.info(`Purging data until block ${blockId}`);

            this.log(`Purging transactions...`);
            await this.transactionRepository.deleteTransactionsFromBlockHeight(blockId);

            if (blockId > 0n) {
                this.log(`Purging unspent transactions...`);
                await this.unspentTransactionRepository.deleteTransactionsFromBlockHeight(blockId);
            }

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
        } else {
            const promises: Promise<void>[] = [
                this.transactionRepository.deleteTransactionsFromBlockHeight(blockId),
                this.unspentTransactionRepository.deleteTransactionsFromBlockHeight(blockId),
                this.contractRepository.deleteContractsFromBlockHeight(blockId),
                this.pointerRepository.deletePointerFromBlockHeight(blockId),
                this.blockRepository.deleteBlockHeadersFromBlockHeight(blockId),
                this.blockWitnessRepository.deleteBlockWitnessesFromHeight(blockId),
                this.reorgRepository.deleteReorgs(blockId),
            ];

            await Promise.all(promises);
        }

        if (blockId <= 0n) {
            this.log(`Purging mempool...`);
            await this.mempoolRepository.deleteGreaterThanBlockHeight(blockId);

            this.log(`Purging UTXOs...`);
            await this.unspentTransactionRepository.deleteGreaterThanBlockHeight(blockId);
        }

        this.info(`Data purged until block ${blockId}`);
    }

    public async getAddressOrPublicKeysInformation(
        addressOrPublicKeys: string[],
    ): Promise<IPublicKeyInfoResult> {
        if (!this.publicKeysRepository) {
            throw new Error('Public key repository not initialized');
        }

        return await this.publicKeysRepository.getAddressOrPublicKeysInformation(
            addressOrPublicKeys,
        );
    }

    public async addTweakedPublicKey(tweaked: Buffer): Promise<void> {
        if (!this.publicKeysRepository) {
            throw new Error('Public key repository not initialized');
        }

        await this.publicKeysRepository.addTweakedPublicKey(tweaked, this.currentSession);
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

    public async init(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        await this.connectDatabase();

        if (!this.databaseManager.db) {
            throw new Error('Database not connected');
        }

        this.pointerRepository = new ContractPointerValueRepository(this.databaseManager.db);
        this.contractRepository = new ContractRepository(this.databaseManager.db);
        this.blockRepository = new BlockRepository(this.databaseManager.db);
        this.blockchainInfoRepository = new BlockchainInfoRepository(this.databaseManager.db);
        this.transactionRepository = new TransactionRepository(this.databaseManager.db);
        this.unspentTransactionRepository = new UnspentTransactionRepository(
            this.databaseManager.db,
        );

        this.reorgRepository = new ReorgsRepository(this.databaseManager.db);
        this.blockWitnessRepository = new BlockWitnessRepository(this.databaseManager.db);
        //this.vaultRepository = new VaultRepository(this.databaseManager.db);
        //this.wbtcUTXORepository = new WBTCUTXORepository(this.databaseManager.db);
        //this.compromisedTransactionRepository = new CompromisedTransactionRepository(
        //    this.databaseManager.db,
        //);

        this.mempoolRepository = new MempoolRepository(this.databaseManager.db);

        //this.usedUTXOsRepository = new UsedWbtcUxtoRepository(this.databaseManager.db);
        this.publicKeysRepository = new PublicKeysRepository(this.databaseManager.db);
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

        const latestBlock = await this.blockRepository.getLatestBlock();
        if (!latestBlock) {
            throw new Error('No latest block found');
        }

        return this.convertBlockHeaderToBlockHeaderDocument(latestBlock);
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

        if (this.currentSession || this.utxoSession) {
            throw new Error('Session already started');
        }

        const sessions = await Promise.all([
            this.databaseManager.startSession(),
            this.databaseManager.startSession(),
        ]);

        this.currentSession = sessions[0];
        this.utxoSession = sessions[1];

        this.currentSession.startTransaction(this.getTransactionOptions());
        this.utxoSession.startTransaction(this.getTransactionOptions());
    }

    public async terminateBlock(): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating block');
        }

        if (!this.currentSession || !this.utxoSession) {
            throw new Error('Session not started');
        }

        await Promise.all([
            this.currentSession.commitTransaction(),
            this.commitUTXOPromise,
            ...this.saveTxSessions.map((session) => session.commitTransaction()),
        ]);

        if (this.lastUtxoSession && this.commitUTXOPromise) {
            throw new Error('Last UTXO session not committed');
        }

        this.lastUtxoSession = this.utxoSession;
        this.commitUTXOPromise = this.commitUTXOChanges();

        await this.terminateSession();
    }

    public async revertChanges(_blockId: bigint): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Reverting changes');
        }

        if (!this.currentSession || !this.utxoSession) {
            throw new Error('Session not started');
        }

        if (this.currentSession.hasEnded) {
            throw new Error('Current session has ended');
        }

        try {
            await this.commitUTXOPromise;
        } catch {}

        await Promise.all([
            this.currentSession.abortTransaction(),
            this.utxoSession.abortTransaction(),
            ...this.saveTxSessions.map((session) => session.abortTransaction()),
        ]);

        await this.utxoSession.endSession();

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

    public async setStoragePointers(
        storage: AddressMap<Map<StoragePointer, [MemoryValue, string[]]>>,
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

    /*public async getBlockRootStates(height: bigint): Promise<BlockRootStates | undefined> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.blockRepository.getBlockRootStates(height, this.currentSession);
    }*/

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
        contractAddress: string,
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
        contractAddress: string,
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

    public async saveBlockHeader(blockHeader: BlockHeaderDocument): Promise<void> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        await this.blockRepository.saveBlockHeader(blockHeader, this.currentSession);
    }

    public async getContractFromTweakedPubKey(
        tweakedPublicKey: string,
    ): Promise<ContractInformation | undefined> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.contractRepository.getContractFromTweakedPubKey(tweakedPublicKey);
    }

    public async getBlockHeader(height: bigint): Promise<BlockHeaderDocument | undefined> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        return await this.blockRepository.getBlockHeader(height);
    }

    public async getUTXOs(
        address: string,
        optimize: boolean = false,
    ): Promise<UTXOsOutputTransactions> {
        if (!this.unspentTransactionRepository || !this.mempoolRepository) {
            throw new Error('Transaction repository not initialized');
        }

        const utxos = await Promise.all([
            this.unspentTransactionRepository.getWalletUnspentUTXOS(address, optimize),
            this.mempoolRepository.getPendingTransactions(address),
        ]);

        const confirmed = utxos[0];
        const spentTransactions =
            await this.mempoolRepository.fetchSpentUnspentTransactions(confirmed);

        return {
            pending: utxos[1],
            spentTransactions: spentTransactions,
            confirmed,
        };
    }

    public async getBalanceOf(
        address: string,
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

        try {
            await this.waitForAllSessionsCommitted();
        } catch (e) {
            this.error(`Error killing all pending writes: ${e}`);
        }
    }

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        const chunks = this.chunkArray(transactions, 500);
        const promises = chunks.map(async (chunk) => {
            if (!this.transactionRepository) {
                throw new Error('Transaction repository not initialized');
            }

            const session = this.databaseManager.startSession();
            session.startTransaction(this.getTransactionOptions());

            this.saveTxSessions.push(session);

            await this.transactionRepository.saveTransactions(chunk, session);
        });

        await Promise.all(promises);
    }

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

    private async waitForAllSessionsCommitted(pollInterval: number = 100): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const checkWrites = async (): Promise<boolean> => {
                if (!this.databaseManager.db) {
                    throw new Error('Database not connected');
                }

                try {
                    // Fetch the current operations using currentOp command
                    const result = (await this.databaseManager.db.admin().command({
                        currentOp: true,
                    })) as CurrentOpOutput;

                    // Filter write operations (insert, update, delete, findAndModify)
                    const writeOps = result.inprog.filter((op: OperationDetails) => {
                        if (
                            (op.active && op.transaction) ||
                            op.op === 'insert' ||
                            op.op === 'update' ||
                            op.op === 'remove'
                        ) {
                            return true;
                        }
                    });

                    // If no write operations are active, resolve true
                    return writeOps.length === 0;
                } catch (error) {
                    console.error('Error checking write operations:', error);
                    reject(error as Error);
                    return false;
                }
            };

            // Polling function
            const poll = async () => {
                const writesFinished = await checkWrites();

                if (writesFinished) {
                    resolve();
                } else {
                    setTimeout(poll, pollInterval);
                }
            };

            // Start polling
            await poll();
        });
    }

    private async commitUTXOChanges(): Promise<void> {
        if (!this.lastUtxoSession) {
            return;
        }

        try {
            await this.lastUtxoSession.commitTransaction();
            await this.lastUtxoSession.endSession();

            this.lastUtxoSession = null;
        } catch {
            this.lastUtxoSession = null;

            throw new Error('Unable to commit UTXOs.');
        }
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        return array.reduce<T[][]>((acc, _, i) => {
            if (i % size === 0) {
                acc.push(array.slice(i, i + size));
            }

            return acc;
        }, []);
    }

    private getTransactionOptions(): TransactionOptions {
        return {
            maxCommitTimeMS: 20 * 60000,
        };
    }

    private async connectDatabase(): Promise<void> {
        this.databaseManager.setup();
        await this.databaseManager.connect();
    }

    private async terminateSession(): Promise<void> {
        if (!this.currentSession || !this.utxoSession) {
            throw new Error('Session not started');
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating session');
        }

        const promiseTerminate: Promise<void>[] = [
            this.currentSession.endSession(),
            ...this.saveTxSessions.map((session) => session.endSession()),
        ];

        await Promise.all(promiseTerminate);

        this.currentSession = undefined;
        this.utxoSession = undefined;
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
