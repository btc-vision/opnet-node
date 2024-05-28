import { BufferHelper } from '@btc-vision/bsi-binary';
import { ConfigurableDBManager, DebugLevel } from '@btc-vision/bsi-common';
import { ClientSession, TransactionOptions } from 'mongodb';
import { UTXOsOutputTransactions } from '../../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { SafeBigInt } from '../../../api/routes/safe/SafeMath.js';
import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';
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
import { ITransactionDocument } from '../../../db/interfaces/ITransactionDocument.js';
import { IParsedBlockWitnessDocument } from '../../../db/models/IBlockWitnessDocument.js';
import { BlockchainInformationRepository } from '../../../db/repositories/BlockchainInformationRepository.js';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';
import { BlockWitnessRepository } from '../../../db/repositories/BlockWitnessRepository.js';
import { ContractPointerValueRepository } from '../../../db/repositories/ContractPointerValueRepository.js';
import { ContractRepository } from '../../../db/repositories/ContractRepository.js';
import { ReorgsRepository } from '../../../db/repositories/ReorgsRepository.js';
import { TransactionRepository } from '../../../db/repositories/TransactionRepository.js';
import { MemoryValue, ProvenMemoryValue } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { VMStorage } from '../VMStorage.js';

export class VMMongoStorage extends VMStorage {
    private databaseManager: ConfigurableDBManager;

    private currentSession: ClientSession | undefined;
    private transactionSession: ClientSession | undefined;

    private waitingTransactionSessions: { blockId: bigint; session: ClientSession }[] = [];
    private waitingCommits: Map<bigint, Promise<void>> = new Map();

    private pointerRepository: ContractPointerValueRepository | undefined;
    private contractRepository: ContractRepository | undefined;
    private blockRepository: BlockRepository | undefined;
    private transactionRepository: TransactionRepository | undefined;
    private blockchainInfoRepository: BlockchainInformationRepository | undefined;
    private reorgRepository: ReorgsRepository | undefined;
    private blockWitnessRepository: BlockWitnessRepository | undefined;

    private cachedLatestBlock: BlockHeaderAPIBlockDocument | undefined;
    private readonly maxTransactionSessions: number;

    private committedTransactions: Set<bigint> = new Set<bigint>();
    private writeTransactions: Map<bigint, Promise<void>[]> = new Map<bigint, Promise<void>[]>();

    private startedBlockIds: Set<bigint> = new Set<bigint>();

    private readonly network: string;
    private blockHeightSaveLoop: NodeJS.Timeout | undefined;

    constructor(private readonly config: IBtcIndexerConfig) {
        super();

        this.network = config.BLOCKCHAIN.BITCOIND_NETWORK;
        this.maxTransactionSessions = config.OP_NET.MAXIMUM_TRANSACTION_SESSIONS;

        this.startCache();

        this.databaseManager = new ConfigurableDBManager(this.config);
    }

    public async revertDataUntilBlock(blockId: bigint): Promise<void> {
        /** We must delete all the data until the blockId */
        if (!this.blockRepository) {
            throw new Error('Block header repository not initialized');
        }

        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
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

        await this.updateBlockchainInfo(Number(blockId));

        const promises: Promise<void>[] = [
            this.transactionRepository.deleteTransactionsFromBlockHeight(blockId),
            this.contractRepository.deleteContractsFromBlockHeight(blockId),
            this.pointerRepository.deletePointerFromBlockHeight(blockId),
            this.blockRepository.deleteBlockHeadersFromBlockHeight(blockId),
            this.blockWitnessRepository.deleteBlockWitnessesFromHeight(blockId),
        ];

        await Promise.all(promises);
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

    public resumeWrites(): void {
        this.startCache();
    }

    public async awaitPendingWrites(): Promise<void> {
        if (this.blockHeightSaveLoop) clearTimeout(this.blockHeightSaveLoop);

        for (let action of this.writeTransactions.values()) {
            await Promise.all(action);
        }

        for (let session of this.waitingCommits.values()) {
            await session;
        }

        this.clearCache();

        await this.updateBlockHeight();
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

        this.blockchainInfoRepository = new BlockchainInformationRepository(
            this.databaseManager.db,
        );

        this.reorgRepository = new ReorgsRepository(this.databaseManager.db);
        this.blockWitnessRepository = new BlockWitnessRepository(this.databaseManager.db);
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
        if (this.blockHeightSaveLoop) clearTimeout(this.blockHeightSaveLoop);
    }

    public async prepareNewBlock(blockId: bigint): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Preparing new block');
        }

        if (this.currentSession) {
            throw new Error('Session already started');
        }

        const sessions: Promise<ClientSession>[] = [
            this.databaseManager.startSession(),
            this.databaseManager.startSession(),
        ];

        this.startedBlockIds.add(blockId);

        this.currentSession = await sessions[0];
        this.transactionSession = await sessions[1];

        await this.pushTransactionSession(this.transactionSession, blockId);

        const options: TransactionOptions = {
            maxCommitTimeMS: 29 * 60000,
        };

        this.currentSession.startTransaction(options);
        this.transactionSession.startTransaction(options);
    }

    public async terminateBlock(blockId: bigint): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating block');
        }

        if (!this.currentSession) {
            throw new Error('Session not started');
        }

        if (!this.transactionSession) {
            throw new Error('Transaction session not started');
        }

        const commitPromises: Promise<void>[] = [this.currentSession.commitTransaction()];
        void this.fakeWaitCommit(this.transactionSession, blockId);

        await Promise.all(commitPromises);

        await this.terminateSession();
    }

    public async revertChanges(blockId: bigint): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
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

        // We revert the blocks that we might not have committed
        await this.updateCurrentBlockId(blockId - BigInt(this.maxTransactionSessions));
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
        blockHeight: bigint,
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.transactionSession) {
            throw new Error('Session not started');
        }

        const promise = this.transactionRepository.saveTransactions(
            transactions,
            this.transactionSession,
        );
        const data = this.writeTransactions.get(blockHeight) || [];
        data.push(promise);

        this.writeTransactions.set(blockHeight, data);
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

    public async getUTXOs(
        address: BitcoinAddress,
        optimize: boolean = false,
    ): Promise<UTXOsOutputTransactions> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        return await this.transactionRepository.getWalletUnspentUTXOS(address, optimize);
    }

    public async getBalanceOf(address: BitcoinAddress): Promise<bigint | undefined> {
        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        return await this.transactionRepository.getBalanceOf(address);
    }

    private async fakeWaitCommit(
        transactionSession: ClientSession,
        blockId: bigint,
    ): Promise<void> {
        const promise = this.commitTransactionSession(transactionSession, blockId).catch(
            async (error) => {
                console.log(
                    `[REVERT 10 BLOCK NEEDED] SOMETHING WENT WRONG COMMITTING TRANSACTION: ${error}`,
                );

                await Promise.all([
                    this.abortTransactionSession(blockId),
                    this.revertChanges(blockId),
                ]);
            },
        );

        this.waitingCommits.set(blockId, promise);

        await promise;

        this.waitingCommits.delete(blockId);
    }

    private smallestBigIntInArray(arr: bigint[]): bigint {
        return arr.reduce((acc, val) => (val < acc ? val : acc), arr[0]);
    }

    private async updateCurrentBlockId(n: bigint): Promise<void> {
        this.committedTransactions.add(n);
    }

    private async commitUntilBlockId(i: bigint): Promise<void> {
        while (this.committedTransactions.has(i)) {
            if (!this.committedTransactions.has(i)) {
                break;
            }

            this.startedBlockIds.delete(i);
            this.committedTransactions.delete(i);

            let blockId: number = 0;
            if (i > 0) {
                blockId = Number(i);
            }

            // We update the block we just processed
            await this.updateBlockchainInfo(blockId + 1);

            i++;
        }
    }

    private async updateBlockchainInfo(blockHeight: number): Promise<void> {
        if (!this.blockchainInfoRepository) {
            throw new Error('Blockchain information repository not initialized');
        }

        await this.blockchainInfoRepository.updateCurrentBlockInProgress(this.network, blockHeight);
    }

    private async abortTransactionSession(revertFromBlockId: bigint): Promise<void> {
        for (const sessionData of this.waitingTransactionSessions) {
            const session = sessionData.session;
            const blockId = sessionData.blockId;

            const commitPromise = this.waitingCommits.get(blockId);
            if (blockId >= revertFromBlockId) {
                await session.abortTransaction();
                await session.endSession();
            } else {
                if (commitPromise) await commitPromise;
                await session.endSession();
            }
        }

        this.waitingCommits.clear();
        this.waitingTransactionSessions = [];
    }

    private async commitTransactionSession(session: ClientSession, blockId: bigint): Promise<void> {
        const promiseSaves = this.writeTransactions.get(blockId) || [];
        if (promiseSaves) {
            await Promise.all(promiseSaves);
        }

        await session.commitTransaction();

        await this.terminateTransactionSession(session, blockId);

        // We revert the blocks that we might not have committed
        await this.updateCurrentBlockId(blockId);
    }

    private async pushTransactionSession(session: ClientSession, blockId: bigint): Promise<void> {
        if (this.waitingTransactionSessions.length > this.maxTransactionSessions) {
            const lastSession = this.waitingTransactionSessions[0];
            if (!lastSession) throw new Error('Session not found');

            this.warn(`Too many transaction sessions. Waiting for a session to be committed.`);

            const waitingSave = this.writeTransactions.get(lastSession.blockId);
            if (waitingSave) {
                await Promise.all(waitingSave);
            }

            const pendingCommit = this.waitingCommits.get(lastSession.blockId);
            if (pendingCommit) {
                await pendingCommit;
            }
        }

        this.waitingTransactionSessions.push({
            session,
            blockId,
        });
    }

    private async terminateTransactionSession(
        session: ClientSession,
        blockId: bigint,
    ): Promise<void> {
        // remove session from waiting list
        const index = this.waitingTransactionSessions.findIndex((s) => s.session === session);
        if (index === -1) {
            throw new Error(`Session not found for block ${blockId}`);
        }

        this.waitingTransactionSessions.splice(index, 1);

        await session.endSession();
    }

    private startCache(): void {
        this.blockHeightSaveLoop = setTimeout(async () => {
            this.clearCache();
            await this.updateBlockHeight();

            this.startCache();
        }, 3000);
    }

    private async updateBlockHeight(): Promise<void> {
        const v: bigint[] = Array.from(this.startedBlockIds.values());
        const smallestBlockInCommittedTransactions = this.smallestBigIntInArray(v);

        await this.commitUntilBlockId(smallestBlockInCommittedTransactions);
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

        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug('Terminating session');
        }

        const promiseTerminate: Promise<void>[] = [this.currentSession.endSession()];
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
