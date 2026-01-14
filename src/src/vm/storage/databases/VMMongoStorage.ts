import { Address, AddressMap } from '@btc-vision/transaction';
import { ConfigurableDBManager, DebugLevel } from '@btc-vision/bsi-common';
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
import { MemoryValue, ProvenMemoryValue, ProvenPointers } from '../types/MemoryValue.js';
import { StoragePointer } from '../types/StoragePointer.js';
import { VMStorage } from '../VMStorage.js';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { UnspentTransactionRepository } from '../../../db/repositories/UnspentTransactionRepository.js';
import { Config } from '../../../config/Config.js';
import { CurrentOpOutput, OperationDetails } from '../interfaces/StorageInterfaces.js';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { PublicKeysRepository } from '../../../db/repositories/PublicKeysRepository.js';
import { IPublicKeyInfoResult } from '../../../api/json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';
import { EpochRepository } from '../../../db/repositories/EpochRepository.js';
import { EpochSubmissionRepository } from '../../../db/repositories/EpochSubmissionsRepository.js';
import { Binary } from 'mongodb';
import { IEpochDocument } from '../../../db/documents/interfaces/IEpochDocument.js';
import { IEpochSubmissionsDocument } from '../../../db/documents/interfaces/IEpochSubmissionsDocument.js';
import { TargetEpochRepository } from '../../../db/repositories/TargetEpochRepository.js';
import { ITargetEpochDocument } from '../../../db/documents/interfaces/ITargetEpochDocument.js';
import { AttestationProof } from '../../../blockchain-indexer/processor/block/merkle/EpochMerkleTree.js';
import { ChallengeSolution } from '../../../blockchain-indexer/processor/interfaces/TransactionPreimage.js';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';
import {
    SpentUTXOSOutputTransaction,
    UTXOsOutputTransactions,
} from '../../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { IMLDSAPublicKey, MLDSAUpdateData } from '../../../db/interfaces/IMLDSAPublicKey.js';
import {
    MLDSAPublicKeyExists,
    MLDSAPublicKeyRepository,
} from '../../../db/repositories/MLDSAPublicKeysRepository.js';
import { getMongodbMajorVersion } from './MongoUtils.js';

export class VMMongoStorage extends VMStorage {
    private databaseManager: ConfigurableDBManager;
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
    private epochRepository: EpochRepository | undefined;
    private epochSubmissionRepository: EpochSubmissionRepository | undefined;
    private targetEpochRepository: TargetEpochRepository | undefined;
    private mldsaPublicKeysRepository: MLDSAPublicKeyRepository | undefined;
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

    public getMLDSAPublicKeyFromHash(
        publicKey: Buffer | Binary,
        blockHeight: bigint,
    ): Promise<IMLDSAPublicKey | null> {
        if (!this.mldsaPublicKeysRepository) {
            throw new Error('MLDSA Public Key repository not initialized');
        }

        return this.mldsaPublicKeysRepository.getByHashedPublicKey(publicKey, blockHeight);
    }

    public saveMLDSAPublicKeys(keys: MLDSAUpdateData[]): Promise<void> {
        if (!this.mldsaPublicKeysRepository) {
            throw new Error('MLDSA Public Key repository not initialized');
        }

        return this.mldsaPublicKeysRepository.savePublicKeys(keys);
    }

    public mldsaPublicKeyExists(
        hashedPublicKey: Buffer | Binary,
        legacyPublicKey: Buffer | Binary,
    ): Promise<MLDSAPublicKeyExists> {
        if (!this.mldsaPublicKeysRepository) {
            throw new Error('MLDSA Public Key repository not initialized');
        }

        return this.mldsaPublicKeysRepository.exists(hashedPublicKey, legacyPublicKey);
    }

    public getMLDSAByLegacy(
        publicKey: Buffer | Binary,
        blockHeight: bigint,
    ): Promise<IMLDSAPublicKey | null> {
        if (!this.mldsaPublicKeysRepository) {
            throw new Error('MLDSA Public Key repository not initialized');
        }

        return this.mldsaPublicKeysRepository.getByHashedOrLegacy(publicKey, blockHeight);
    }

    public targetEpochExists(
        epochNumber: bigint,
        salt: Buffer | Binary,
        mldsaPublicKey: Buffer | Binary,
    ): Promise<boolean> {
        if (!this.targetEpochRepository) {
            throw new Error('Target epoch repository not initialized');
        }

        return this.targetEpochRepository.targetEpochExists(epochNumber, salt, mldsaPublicKey);
    }

    public getBestTargetEpoch(epochNumber: bigint): Promise<ITargetEpochDocument | null> {
        if (!this.targetEpochRepository) {
            throw new Error('Target epoch repository not initialized');
        }

        return this.targetEpochRepository.getBestTargetEpoch(epochNumber);
    }

    public saveSubmission(submission: IEpochSubmissionsDocument): Promise<void> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.saveSubmission(submission);
    }

    public saveTargetEpoch(targetEpoch: ITargetEpochDocument): Promise<void> {
        if (!this.targetEpochRepository) {
            throw new Error('Target epoch repository not initialized');
        }

        return this.targetEpochRepository.saveTargetEpoch(targetEpoch);
    }

    public deleteOldTargetEpochs(epochNumber: bigint): Promise<void> {
        if (!this.targetEpochRepository) {
            throw new Error('Target epoch repository not initialized');
        }

        return this.targetEpochRepository.deleteOldTargetEpochs(epochNumber);
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

        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        if (!this.epochSubmissionRepository) {
            throw new Error('Public key repository not initialized');
        }

        if (!this.targetEpochRepository) {
            throw new Error('Target epoch repository not initialized');
        }

        if (!this.mldsaPublicKeysRepository) {
            throw new Error('MLDSA Public Key repository not initialized');
        }

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

            this.log(`Purging epochs...`);
            await this.epochRepository.deleteEpochFromBitcoinBlockNumber(blockId);

            this.log(`Purging epoch submissions...`);
            await this.epochSubmissionRepository.deleteSubmissionsFromBlock(blockId);

            this.log(`Purging target epochs...`);
            await this.targetEpochRepository.deleteAllTargetEpochs();

            this.log(`Purging MLDSA public keys...`);
            await this.mldsaPublicKeysRepository.deleteFromBlockHeight(blockId);
        } else {
            const promises: Promise<void>[] = [
                this.transactionRepository.deleteTransactionsFromBlockHeight(blockId),
                this.unspentTransactionRepository.deleteTransactionsFromBlockHeight(blockId),
                this.contractRepository.deleteContractsFromBlockHeight(blockId),
                this.pointerRepository.deletePointerFromBlockHeight(blockId),
                this.blockRepository.deleteBlockHeadersFromBlockHeight(blockId),
                this.blockWitnessRepository.deleteBlockWitnessesFromHeight(blockId),
                this.reorgRepository.deleteReorgs(blockId),
                this.epochRepository.deleteEpochFromBitcoinBlockNumber(blockId),
                this.epochSubmissionRepository.deleteSubmissionsFromBlock(blockId),
                this.targetEpochRepository.deleteAllTargetEpochs(),
                this.mldsaPublicKeysRepository.deleteFromBlockHeight(blockId),
            ];

            await Promise.safeAll(promises);
        }

        if (blockId <= 0n) {
            this.log(`Purging mempool...`);
            await this.mempoolRepository.deleteGreaterThanBlockHeight(blockId);

            this.log(`Purging UTXOs...`);
            await this.unspentTransactionRepository.deleteGreaterThanBlockHeight(blockId);
        }

        this.info(`Data purged until block ${blockId}`);
    }

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        const chunks = this.chunkArray(transactions, 500);
        const promises = chunks.map(async (chunk) => {
            if (!this.transactionRepository) {
                throw new Error('Transaction repository not initialized');
            }

            await this.transactionRepository.saveTransactions(chunk);
        });

        await Promise.safeAll(promises);
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
        await this.publicKeysRepository.addTweakedPublicKey(tweaked);
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

        return await this.blockWitnessRepository.getWitnesses(height, trusted, limit, page ?? 1);
    }

    public async getWitnessesForEpoch(
        startBlock: bigint,
        endBlock: bigint,
        limitPerBlock: number,
    ): Promise<IParsedBlockWitnessDocument[]> {
        if (!this.blockWitnessRepository) {
            throw new Error('Block witness repository not initialized');
        }

        return await this.blockWitnessRepository.getWitnessesForEpoch(
            startBlock,
            endBlock,
            limitPerBlock,
        );
    }

    public async init(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        await this.connectDatabase();

        if (!this.databaseManager.db) {
            throw new Error('Database not connected');
        }

        const dbVersion = await getMongodbMajorVersion(this.databaseManager.db);

        this.pointerRepository = new ContractPointerValueRepository(this.databaseManager.db);
        this.contractRepository = new ContractRepository(this.databaseManager.db);
        this.blockRepository = new BlockRepository(this.databaseManager.db);
        this.blockchainInfoRepository = new BlockchainInfoRepository(this.databaseManager.db);
        this.transactionRepository = new TransactionRepository(this.databaseManager.db);
        this.unspentTransactionRepository = new UnspentTransactionRepository(
            this.databaseManager.db,
            dbVersion,
        );

        this.reorgRepository = new ReorgsRepository(this.databaseManager.db);
        this.blockWitnessRepository = new BlockWitnessRepository(this.databaseManager.db);
        this.mempoolRepository = new MempoolRepository(this.databaseManager.db, dbVersion);
        this.publicKeysRepository = new PublicKeysRepository(this.databaseManager.db);
        this.epochRepository = new EpochRepository(this.databaseManager.db);
        this.epochSubmissionRepository = new EpochSubmissionRepository(this.databaseManager.db);
        this.targetEpochRepository = new TargetEpochRepository(this.databaseManager.db);
        this.mldsaPublicKeysRepository = new MLDSAPublicKeyRepository(this.databaseManager.db);
    }

    public async deleteTransactionsById(ids: string[]): Promise<void> {
        if (!this.mempoolRepository) {
            throw `Mempool repository not defined.`;
        }
        await this.mempoolRepository.deleteTransactionsById(ids);
    }

    public async findConflictingTransactions(
        transaction: IMempoolTransactionObj,
    ): Promise<IMempoolTransactionObj[]> {
        if (!this.mempoolRepository) {
            throw `Mempool repository not defined.`;
        }

        return await this.mempoolRepository.findConflictingTransactions(transaction);
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

    public async updateWitnessProofs(attestationProofs: AttestationProof[]): Promise<void> {
        if (!this.blockWitnessRepository) {
            throw new Error('Block witness repository not initialized');
        }
        await this.blockWitnessRepository.updateWitnessProofs(attestationProofs);
    }

    public async getBlockTransactions(
        height: SafeBigInt = -1,
        hash?: string,
        includeTransactions?: boolean,
        checksum?: boolean,
    ): Promise<BlockWithTransactions | undefined> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }

        if (!this.transactionRepository) {
            throw new Error('Transaction repository not initialized');
        }

        if (!this.contractRepository) {
            throw new Error('Contract repository not initialized');
        }

        let block: IBlockHeaderBlockDocument | undefined;
        if (hash) {
            block = await this.blockRepository.getBlockByHash(hash, checksum || false);
        } else {
            block =
                height === -1
                    ? await this.blockRepository.getLatestBlock()
                    : await this.blockRepository.getBlockHeader(height);
        }

        if (!block) {
            return undefined;
        }

        const deployments =
            includeTransactions === true
                ? await this.contractRepository.getContractsDeployedAtHeight(block.height)
                : [];

        const transactions =
            includeTransactions === true
                ? await this.transactionRepository.getTransactionsByBlockHash(block.height)
                : [];

        return {
            block: this.convertBlockHeaderToBlockHeaderDocument(block),
            transactions,
            deployments,
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

    public async getStorageMultiple(
        pointers: AddressMap<Uint8Array[]>,
        height?: bigint,
    ): Promise<ProvenPointers | null> {
        if (!this.pointerRepository) {
            throw new Error('Repository not initialized');
        }

        const values = await this.pointerRepository.getByContractsAndPointers(pointers, height);
        if (!values) {
            return null;
        }
        return values;
    }

    public async getStorage(
        address: Address,
        pointer: StoragePointer,
        height?: bigint,
    ): Promise<ProvenMemoryValue | null> {
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

        if (!value) {
            return null;
        }

        return {
            value: value.value,
            proofs: value.proofs,
            lastSeenAt: value.lastSeenAt,
        };
    }

    public async setStoragePointers(
        storage: AddressMap<Map<StoragePointer, [MemoryValue, string[]]>>,
        lastSeenAt: bigint,
    ): Promise<void> {
        if (!this.pointerRepository) {
            throw new Error('Repository not initialized');
        }

        await this.pointerRepository.setStoragePointers(storage, lastSeenAt);
    }

    public async setContractAt(contractData: ContractInformation): Promise<void> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }
        await this.contractRepository.setContract(contractData);
    }

    public async getContractAt(
        contractAddress: string,
        height?: bigint,
    ): Promise<ContractInformation | undefined> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }
        return await this.contractRepository.getContract(contractAddress, height);
    }

    public async getContractAddressAt(
        contractAddress: string,
        height?: bigint,
    ): Promise<Address | undefined> {
        if (!this.contractRepository) {
            throw new Error('Repository not initialized');
        }
        return await this.contractRepository.getContractAddressAt(contractAddress, height);
    }

    public async saveBlockHeader(blockHeader: BlockHeaderDocument): Promise<void> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }
        await this.blockRepository.saveBlockHeader(blockHeader);
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
        olderThan: bigint | undefined,
    ): Promise<UTXOsOutputTransactions> {
        if (!this.unspentTransactionRepository || !this.mempoolRepository) {
            throw new Error('Transaction repository not initialized');
        }

        const utxos = await Promise.safeAll([
            this.unspentTransactionRepository.getWalletUnspentUTXOS(address, optimize, olderThan),
            olderThan === undefined
                ? this.mempoolRepository.getPendingTransactions(address)
                : { utxos: [], raw: [] },
        ]);

        const confirmedResult = utxos[0];
        const pendingResult = utxos[1];

        const allUtxosForSpentCheck: SpentUTXOSOutputTransaction[] = [
            ...confirmedResult.utxos.map((u) => ({
                transactionId: u.transactionId,
                outputIndex: u.outputIndex,
            })),
            ...pendingResult.utxos.map((u) => ({
                transactionId: u.transactionId,
                outputIndex: u.outputIndex,
            })),
        ];

        const spentIdentifiers =
            await this.mempoolRepository.fetchSpentUnspentTransactions(allUtxosForSpentCheck);

        const rawTxMap = new Map<string, number>();
        const rawArray: string[] = [];

        const mapRawIndex = (
            txId: string,
            currentIndex: number | undefined,
            sourceArray: string[],
        ): number | undefined => {
            if (currentIndex === undefined) return undefined;

            let globalIndex = rawTxMap.get(txId);
            if (globalIndex === undefined) {
                globalIndex = rawArray.length;
                rawArray.push(sourceArray[currentIndex]);
                rawTxMap.set(txId, globalIndex);
            }
            return globalIndex;
        };

        const confirmed = confirmedResult.utxos.map((utxo) => ({
            ...utxo,
            raw: mapRawIndex(utxo.transactionId, utxo.raw, confirmedResult.raw),
        }));

        const pending = pendingResult.utxos.map((utxo) => ({
            ...utxo,
            raw: mapRawIndex(utxo.transactionId, utxo.raw, pendingResult.raw),
        }));

        return {
            confirmed,
            spentTransactions: spentIdentifiers,
            pending,
            raw: rawArray,
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

    public getLatestEpoch(): Promise<IEpochDocument | undefined> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getLatestEpoch();
    }

    public getEpochByNumber(epochNumber: SafeBigInt): Promise<IEpochDocument | undefined> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getEpochByNumber(epochNumber);
    }

    public getEpochByHash(epochHash: Buffer | Binary): Promise<IEpochDocument | undefined> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getEpochByHash(epochHash);
    }

    public getEpochByBlockHeight(blockHeight: bigint): Promise<IEpochDocument | undefined> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getEpochByBlockHeight(blockHeight);
    }

    public getChallengeSolutionsAtHeight(blockHeight: bigint): Promise<ChallengeSolution> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getChallengeSolutionsAtHeight(blockHeight);
    }

    public getActiveEpoch(): Promise<IEpochDocument | undefined> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getActiveEpoch();
    }

    public getEpochsByProposer(proposerPublicKey: Buffer | Binary): Promise<IEpochDocument[]> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getEpochsByProposer(proposerPublicKey);
    }

    public getEpochsByTargetHash(targetHash: Buffer | Binary): Promise<IEpochDocument[]> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.getEpochsByTargetHash(targetHash);
    }

    public saveEpoch(epoch: IEpochDocument): Promise<void> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.saveEpoch(epoch);
    }

    public updateEpochEndBlock(epochNumber: bigint, endBlock: bigint): Promise<void> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.updateEpochEndBlock(epochNumber, endBlock);
    }

    public deleteEpochFromBitcoinBlockNumber(bitcoinBlockNumber: bigint): Promise<void> {
        if (!this.epochRepository) {
            throw new Error('Epoch repository not initialized');
        }

        return this.epochRepository.deleteEpochFromBitcoinBlockNumber(bitcoinBlockNumber);
    }

    public getSubmissionsByEpochNumber(epochNumber: bigint): Promise<IEpochSubmissionsDocument[]> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.getSubmissionsByEpochNumber(epochNumber);
    }

    public getSubmissionByTxHash(
        txHash: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument | undefined> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.getSubmissionByTxHash(txHash);
    }

    public getSubmissionByTxId(
        txId: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument | undefined> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.getSubmissionByTxId(txId);
    }

    public getSubmissionsInBlockRange(
        startBlock: bigint,
        endBlock: bigint,
    ): Promise<IEpochSubmissionsDocument[]> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.getSubmissionsInBlockRange(startBlock, endBlock);
    }

    public getSubmissionsByProposer(
        proposerPublicKey: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument[]> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.getSubmissionsByProposer(proposerPublicKey);
    }

    public getPendingSubmissions(fromBlock: bigint): Promise<IEpochSubmissionsDocument[]> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.getPendingSubmissions(fromBlock);
    }

    public getSubmissionByHash(
        submissionHash: Buffer | Binary,
    ): Promise<IEpochSubmissionsDocument | undefined> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.getSubmissionByHash(submissionHash);
    }

    public submissionExists(
        publicKey: Buffer | Binary,
        salt: Buffer | Binary,
        epochNumber: bigint,
    ): Promise<boolean> {
        if (!this.epochSubmissionRepository) {
            throw new Error('Epoch submission repository not initialized');
        }

        return this.epochSubmissionRepository.submissionExists(publicKey, salt, epochNumber);
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        return array.reduce<T[][]>((acc, _, i) => {
            if (i % size === 0) {
                acc.push(array.slice(i, i + size));
            }

            return acc;
        }, []);
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

    private async connectDatabase(): Promise<void> {
        this.databaseManager.setup();
        await this.databaseManager.connect();
    }
}
