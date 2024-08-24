import {
    BaseRepository,
    DataAccessError,
    DataAccessErrorType,
    DebugLevel,
} from '@btc-vision/bsi-common';
import {
    AggregateOptions,
    Binary,
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

        await this.updateMany(criteriaSpent, { deletedAtBlock: null }, currentSession);
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
        blockHeight: bigint,
        transactions: ITransactionDocumentBasic<OPNetTransactionTypes>[],
        currentSession?: ClientSession,
    ): Promise<void> {
        const start = Date.now();

        const convertedSpentTransactions = this.convertSpentTransactions(transactions);
        const convertedUnspentTransactions = this.convertToUnspentTransactions(
            transactions,
            convertedSpentTransactions,
        );

        const bulkWriteOperations = convertedUnspentTransactions.map((transaction) => {
            return {
                updateOne: {
                    filter: {
                        transactionId: transaction.transactionId,
                        outputIndex: transaction.outputIndex,
                        blockHeight: transaction.blockHeight,
                    },
                    update: {
                        $set: transaction,
                    },
                    upsert: true,
                },
            };
        });

        if (bulkWriteOperations.length) {
            await this.bulkWrite(bulkWriteOperations, currentSession);
        }

        const currentBlockHeight = this.bigIntToLong(blockHeight);
        const bulkDeleteOperations = convertedSpentTransactions.map((transaction) => {
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
                            deletedAtBlock: currentBlockHeight,
                        },
                    },
                    upsert: true, // allow upsert, if not exist?
                },
            };
        });

        if (bulkDeleteOperations.length) {
            await this.bulkWrite(bulkDeleteOperations, currentSession);
        }

        if (Config.INDEXER.ALLOW_PURGE && Config.INDEXER.PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS) {
            await this.purgeSpentUTXOsFromBlockHeight(
                blockHeight - BigInt(Config.INDEXER.PURGE_SPENT_UTXO_OLDER_THAN_BLOCKS),
                currentSession,
            );
        }

        if (Config.DEBUG_LEVEL > DebugLevel.INFO) {
            this.log(
                `Saved ${convertedUnspentTransactions.length} UTXOs, deleted ${convertedSpentTransactions.length} spent UTXOs in ${Date.now() - start}ms`,
            );
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

    // Transactions to delete
    private convertSpentTransactions(
        transactions: ITransactionDocumentBasic<OPNetTransactionTypes>[],
    ): ISpentTransaction[] {
        return transactions.flatMap((transaction) => {
            return transaction.inputs
                .map((input) => {
                    if (!input.originalTransactionId || input.outputTransactionIndex == null) {
                        return null;
                    }

                    return {
                        transactionId: input.originalTransactionId,
                        outputIndex: input.outputTransactionIndex || 0, // legacy block miner rewards?
                    };
                })
                .filter((input) => input !== null);
        });
    }

    private convertToUnspentTransactions(
        transactions: ITransactionDocumentBasic<OPNetTransactionTypes>[],
        spentTransactions: ISpentTransaction[],
    ): IUnspentTransaction[] {
        return transactions.flatMap((transaction) => {
            return transaction.outputs
                .map((output) => {
                    if (
                        spentTransactions.some(
                            (spent) =>
                                spent.transactionId === transaction.id &&
                                spent.outputIndex === output.index,
                        )
                    ) {
                        return null;
                    }

                    if (
                        (typeof output.value === 'string' && output.value === '0') ||
                        output.value.toString() === '0'
                    ) {
                        return null;
                    }

                    if (!output.scriptPubKey.address) {
                        this.panic(`Output ${transaction.id}:${output.index} has no address!`);
                    }

                    return {
                        blockHeight: this.decimal128ToLong(transaction.blockHeight),
                        transactionId: transaction.id,
                        outputIndex: output.index,
                        value: this.decimal128ToLong(output.value),
                        scriptPubKey: {
                            hex: Binary.createFromHexString(output.scriptPubKey.hex),
                            address: output.scriptPubKey.address ?? null,
                        },
                        deletedAtBlock: null, // force to null
                    };
                })
                .filter((output) => output !== null);
        });
    }
}
