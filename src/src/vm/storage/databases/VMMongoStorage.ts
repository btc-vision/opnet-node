import { Address, AddressMap } from '@btc-vision/transaction';
import { ConfigurableDBManager, DebugLevel } from '@btc-vision/bsi-common';
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
        this.mempoolRepository = new MempoolRepository(this.databaseManager.db);
        this.publicKeysRepository = new PublicKeysRepository(this.databaseManager.db);
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
        if (!this.contractRepository) {
            throw new Error('Contract repository not initialized');
        }

        let block: IBlockHeaderBlockDocument | undefined;
        if (hash) {
            block = await this.blockRepository.getBlockByHash(hash);
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

    public async getPreimage(blockHeight: bigint): Promise<string> {
        if (!this.blockRepository) {
            throw new Error('Repository not initialized');
        }
        return await this.blockRepository.getBlockPreimage(blockHeight);
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
    ): Promise<UTXOsOutputTransactions> {
        if (!this.unspentTransactionRepository || !this.mempoolRepository) {
            throw new Error('Transaction repository not initialized');
        }

        const utxos = await Promise.safeAll([
            this.unspentTransactionRepository.getWalletUnspentUTXOS(address, optimize),
            this.mempoolRepository.getPendingTransactions(address),
        ]);

        const confirmed = utxos[0];
        const spentTransactions = await this.mempoolRepository.fetchSpentUnspentTransactions([
            ...utxos[0],
            ...utxos[1],
        ]);

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
