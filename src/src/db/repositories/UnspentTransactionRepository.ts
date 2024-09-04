import {
    BaseRepository,
    DataAccessError,
    DataAccessErrorType,
    DebugLevel,
} from '@btc-vision/bsi-common';
import {
    AggregateOptions,
    AnyBulkWriteOperation,
    Binary,
    BulkWriteOptions,
    BulkWriteResult,
    ClientSession,
    Collection,
    Db,
    Decimal128,
    Document,
    Filter,
    Long,
    UpdateOptions,
} from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { ITransactionDocumentBasic } from '../interfaces/ITransactionDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { ISpentTransaction, IUnspentTransaction } from '../interfaces/IUnspentTransaction.js';
import { Config } from '../../config/Config.js';
import { Address } from '@btc-vision/bsi-binary';
import { BalanceOfOutputTransactionFromDB } from '../../vm/storage/databases/aggregation/BalanceOfAggregation.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { UTXOsOutputTransactions } from '../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import {
    UTXOsAggregationV2,
    UTXOSOutputTransactionFromDBV2,
} from '../../vm/storage/databases/aggregation/UTXOsAggregationV2.js';
import { BalanceOfAggregationV2 } from '../../vm/storage/databases/aggregation/BalanceOfAggregationV2.js';

export interface ProcessUnspentTransaction {
    transactions: ITransactionDocumentBasic<OPNetTransactionTypes>[];
    blockHeight: bigint;
}

export type ProcessUnspentTransactionList = ProcessUnspentTransaction[];

export class UnspentTransactionRepository extends BaseRepository<IUnspentTransaction> {
    public readonly logColor: string = '#afeeee';

    private readonly uxtosAggregation: UTXOsAggregationV2 = new UTXOsAggregationV2();
    private readonly balanceOfAggregation: BalanceOfAggregationV2 = new BalanceOfAggregationV2();

    constructor(db: Db) {
        super(db);
    }

    public bigIntToLong(bigInt: bigint): Long {
        return Long.fromBigInt(bigInt);
    }

    public decimal128ToLong(decimal128: Decimal128 | string): Long {
        return Long.fromString(decimal128.toString());
    }

    public async deleteTransactionsFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IUnspentTransaction>> = {
            blockHeight: { $gte: this.bigIntToLong(blockHeight) },
        };

        await this.delete(criteria, currentSession);

        const criteriaSpent: Partial<Filter<IUnspentTransaction>> = {
            deletedAtBlock: { $gte: this.bigIntToLong(blockHeight) },
        };

        await this.updateMany(criteriaSpent, { deletedAtBlock: undefined }, currentSession);

        await this.delete(
            {
                value: undefined,
            },
            currentSession,
        );
    }

    public async updateMany(
        criteria: Partial<Filter<IUnspentTransaction>>,
        document: Partial<IUnspentTransaction>,
        currentSession?: ClientSession,
    ): Promise<void> {
        try {
            const collection = this.getCollection();
            const options: UpdateOptions = {
                ...this.getOptions(currentSession),
                upsert: false,
            };

            const updateResult = await collection.updateMany(criteria, { $set: document }, options);

            if (!updateResult.acknowledged) {
                throw new DataAccessError(
                    'Concurrency error while updating.',
                    DataAccessErrorType.Concurency,
                    '',
                );
            }
        } catch (error) {
            if (error instanceof Error) {
                const errorDescription: string = error.stack || error.message;

                throw new DataAccessError(errorDescription, DataAccessErrorType.Unknown, '');
            } else {
                throw error;
            }
        }
    }

    public async insertTransactions(
        transactions: ProcessUnspentTransactionList,
        currentSession?: ClientSession,
    ): Promise<void> {
        const start = Date.now();

        let blockHeight = 0n;
        for (const data of transactions) {
            if (data.blockHeight > blockHeight) {
                blockHeight = data.blockHeight;
            }
        }

        //let promise: Promise<void> | undefined;
        if (Config.INDEXER.ALLOW_PURGE && Config.INDEXER.PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS) {
            await this.purgeSpentUTXOsFromBlockHeight(
                blockHeight - BigInt(Config.INDEXER.PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS),
            );
        }

        const convertedSpentTransactions = this.convertSpentTransactions(transactions);
        const convertedUnspentTransactions = this.convertToUnspentTransactions(
            transactions,
            convertedSpentTransactions,
        );

        const bulkDeleteOperations: AnyBulkWriteOperation<IUnspentTransaction>[] =
            convertedSpentTransactions.map((transaction) => {
                return {
                    updateOne: {
                        filter: {
                            transactionId: transaction.transactionId,
                            outputIndex: transaction.outputIndex,
                        },
                        update: {
                            $set: transaction,
                        },
                        upsert: true,
                    },
                };
            });

        const bulkWriteOperations: AnyBulkWriteOperation<IUnspentTransaction>[] =
            convertedUnspentTransactions.map((transaction) => {
                return {
                    updateOne: {
                        filter: {
                            transactionId: transaction.transactionId,
                            outputIndex: transaction.outputIndex,
                        },
                        update: {
                            $set: {
                                transactionId: transaction.transactionId,
                                outputIndex: transaction.outputIndex,
                                value: transaction.value,
                                blockHeight: transaction.blockHeight,
                                scriptPubKey: {
                                    hex: transaction.scriptPubKey.hex,
                                    address: transaction.scriptPubKey.address,
                                },
                            },
                        },
                        upsert: true,
                    },
                };
            });

        this.important(
            `[UTXO]: Writing ${bulkWriteOperations.length} UTXOs, deleting ${bulkDeleteOperations.length} spent UTXOs`,
        );

        /*const operations: AnyBulkWriteOperation<IUnspentTransaction>[] = [
            ...bulkWriteOperations,
            ...bulkDeleteOperations,
        ];*/

        if (bulkWriteOperations.length) {
            //const session = await DBManagerInstance.startSession();
            //session.startTransaction();

            this.important(`[UTXO]: Conversion took ${Date.now() - start}ms`);

            const writeStart = Date.now();
            const chunks = this.chunkArray(bulkWriteOperations, 500);

            let promises = [];
            for (const chunk of chunks) {
                promises.push(this.bulkWrite(chunk));
            }

            await Promise.all(promises);

            this.important(`[UTXO]: Bulk write (step 1) took ${Date.now() - writeStart}ms`);

            promises = [];

            const deleteStart = Date.now();
            const deleteChunks = this.chunkArray(bulkDeleteOperations, 500);
            for (const chunk of deleteChunks) {
                promises.push(this.bulkWrite(chunk));
            }

            await Promise.all(promises);

            //await session.commitTransaction();
            //await session.endSession();

            this.important(`[UTXO]: Bulk write (step 2) took ${Date.now() - deleteStart}ms`);
        }

        if (Config.DEBUG_LEVEL > DebugLevel.TRACE && Config.DEV_MODE) {
            this.log(
                `Saved ${convertedUnspentTransactions.length} UTXOs, deleted ${convertedSpentTransactions.length} spent UTXOs in ${Date.now() - start}ms`,
            );
        }
    }

    public async bulkWrite(
        operations: AnyBulkWriteOperation<IUnspentTransaction>[],
        currentSession?: ClientSession,
    ): Promise<void> {
        try {
            const collection = this.getCollection();
            const options: BulkWriteOptions = this.getOptions(currentSession);
            options.ordered = false;
            options.writeConcern = { w: 'majority' };

            const time = Date.now();
            const result: BulkWriteResult = await collection.bulkWrite(operations, options);
            this.important(`[UTXO]: Bulk write took ${Date.now() - time}ms`);

            if (result.hasWriteErrors()) {
                result.getWriteErrors().forEach((error) => {
                    this.error(`Bulk write error: ${error}`);
                });

                throw new DataAccessError('Failed to bulk write.', DataAccessErrorType.Unknown, '');
            }

            if (!result.isOk()) {
                throw new DataAccessError('Failed to bulk write.', DataAccessErrorType.Unknown, '');
            }
        } catch (error) {
            if (error instanceof Error) {
                const errorDescription: string = error.stack || error.message;

                throw new DataAccessError(errorDescription, DataAccessErrorType.Unknown, '');
            } else {
                throw error;
            }
        }
    }

    public async purgeSpentUTXOsFromBlockHeight(
        fromBlockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IUnspentTransaction>> = {
            deletedAtBlock: { $lte: this.bigIntToLong(fromBlockHeight) },
        };

        await this.delete(criteria, currentSession);
    }

    public async getBalanceOf(
        wallet: Address,
        filterOrdinals: boolean,
        currentSession?: ClientSession,
    ): Promise<bigint> {
        const aggregation: Document[] = this.balanceOfAggregation.getAggregation(
            wallet,
            filterOrdinals,
        );

        const collection = this.getCollection();
        const options: AggregateOptions = this.getOptions(currentSession) as AggregateOptions;
        options.allowDiskUse = true;

        const aggregatedDocument = collection.aggregate<BalanceOfOutputTransactionFromDB>(
            aggregation,
            options,
        );

        const results: BalanceOfOutputTransactionFromDB[] = await aggregatedDocument.toArray();
        const balance: Decimal128 = results?.[0]?.balance ?? Decimal128.fromString('0');

        return DataConverter.fromDecimal128(balance);
    }

    public async getWalletUnspentUTXOS(
        wallet: Address,
        optimize: boolean = false,
        currentSession?: ClientSession,
    ): Promise<UTXOsOutputTransactions> {
        // TODO: Add cursor page support.
        const aggregation: Document[] = this.uxtosAggregation.getAggregation(
            wallet,
            true,
            optimize,
        );

        const collection = this.getCollection();
        const options = this.getOptions(currentSession) as AggregateOptions;
        options.allowDiskUse = true;

        try {
            const aggregatedDocument = collection.aggregate<UTXOSOutputTransactionFromDBV2>(
                aggregation,
                options,
            );

            const results: UTXOSOutputTransactionFromDBV2[] = await aggregatedDocument.toArray();

            return results.map((result) => {
                return {
                    transactionId: result.transactionId,
                    outputIndex: result.outputIndex,
                    value: DataConverter.fromDecimal128(result.value),
                    scriptPubKey: {
                        hex: result.scriptPubKey.hex.toString('hex'),
                        address: result.scriptPubKey.address
                            ? result.scriptPubKey.address
                            : undefined,
                    },
                };
            });
        } catch (e) {
            this.error(`Can not fetch UTXOs for wallet ${wallet}: ${(e as Error).stack}`);

            throw e;
        }
    }

    protected override getCollection(): Collection<IUnspentTransaction> {
        return this._db.collection(OPNetCollections.UnspentTransactions);
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        return array.reduce((acc, _, i) => {
            if (i % size === 0) {
                acc.push(array.slice(i, i + size));
            }

            return acc;
        }, [] as T[][]);
    }

    // Transactions to delete
    private convertSpentTransactions(
        transactions: ProcessUnspentTransactionList,
    ): ISpentTransaction[] {
        const finalList: ISpentTransaction[] = [];

        for (const block of transactions) {
            const blockHeight = this.bigIntToLong(block.blockHeight);

            for (const transaction of block.transactions) {
                for (const input of transaction.inputs) {
                    if (input.originalTransactionId && input.outputTransactionIndex != null) {
                        finalList.push({
                            transactionId: input.originalTransactionId,
                            outputIndex: input.outputTransactionIndex || 0, // legacy block miner rewards?
                            deletedAtBlock: blockHeight,
                        });
                    }
                }
            }
        }

        return finalList;
    }

    private convertToUnspentTransactions(
        blocks: ProcessUnspentTransactionList,
        spentTransactions: ISpentTransaction[],
    ): IUnspentTransaction[] {
        const finalList: IUnspentTransaction[] = [];
        const spentSet: Map<string, IUnspentTransaction> = new Map();

        for (const spent of spentTransactions) {
            spentSet.set(
                `${spent.transactionId}:${spent.outputIndex}`,
                spent as IUnspentTransaction,
            );
        }

        for (const block of blocks) {
            for (const transaction of block.transactions) {
                for (const output of transaction.outputs) {
                    const spentKey = `${transaction.id}:${output.index}`;
                    const spent = spentSet.get(spentKey);

                    if (output.value.toString() !== '0' && output.scriptPubKey.address) {
                        if (spent) {
                            spent.blockHeight = this.decimal128ToLong(transaction.blockHeight);
                            spent.value = this.decimal128ToLong(output.value);
                            spent.scriptPubKey = {
                                hex: Binary.createFromHexString(output.scriptPubKey.hex),
                                address: output.scriptPubKey.address ?? null,
                            };
                        } else {
                            finalList.push({
                                blockHeight: this.decimal128ToLong(transaction.blockHeight),
                                transactionId: transaction.id,
                                outputIndex: output.index,
                                value: this.decimal128ToLong(output.value),
                                scriptPubKey: {
                                    hex: Binary.createFromHexString(output.scriptPubKey.hex),
                                    address: output.scriptPubKey.address ?? null,
                                },
                            });
                        }
                    }
                }
            }
        }

        spentSet.clear();

        return finalList;
    }
}
