import { DataConverter, DebugLevel } from '@btc-vision/bsi-common';
import {
    AggregateOptions,
    AnyBulkWriteOperation,
    Binary,
    ClientSession,
    Collection,
    Db,
    Decimal128,
    Document,
    Filter,
    Long,
} from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { ITransactionDocumentBasic } from '../interfaces/ITransactionDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { ISpentTransaction, IUnspentTransaction, ShortScriptPubKey, } from '../interfaces/IUnspentTransaction.js';
import { Config } from '../../config/Config.js';
import {
    RawUTXOsAggregationResultV3
} from '../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { BalanceOfAggregationV2 } from '../../vm/storage/databases/aggregation/BalanceOfAggregationV2.js';
import { ExtendedBaseRepository } from './ExtendedBaseRepository.js';
import { FastStringMap } from '../../utils/fast/FastStringMap.js';
import {
    UTXOsAggregationResultV3,
    UTXOsAggregationV3,
} from '../../vm/storage/databases/aggregation/UTXOsAggregationV3.js';

export interface ProcessUnspentTransaction {
    transactions: ITransactionDocumentBasic<OPNetTransactionTypes>[];
    blockHeight: bigint;
}

export type ProcessUnspentTransactionList = ProcessUnspentTransaction[];

export interface BalanceOfOutputTransactionFromDB {
    readonly balance: Decimal128;
}

export class UnspentTransactionRepository extends ExtendedBaseRepository<IUnspentTransaction> {
    public readonly logColor: string = '#afeeee';

    private readonly uxtosAggregation: UTXOsAggregationV3 = new UTXOsAggregationV3();
    private readonly balanceOfAggregation: BalanceOfAggregationV2 = new BalanceOfAggregationV2();

    public constructor(
        db: Db,
        private readonly dbVersion: number,
    ) {
        super(db);
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
    }

    public async insertTransactions(transactions: ProcessUnspentTransactionList): Promise<void> {
        const start = Date.now();

        let blockHeight = 0n;
        let lowestBlockHeight = -1n;
        for (const data of transactions) {
            if (data.blockHeight > blockHeight) {
                blockHeight = data.blockHeight;
            }

            if (data.blockHeight < lowestBlockHeight || lowestBlockHeight === -1n) {
                lowestBlockHeight = data.blockHeight;
            }
        }

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
                            $set: {
                                transactionId: transaction.transactionId,
                                outputIndex: transaction.outputIndex,
                                deletedAtBlock: transaction.deletedAtBlock,
                            },
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
                                    addresses: !transaction.scriptPubKey.address
                                        ? transaction.scriptPubKey.addresses
                                        : [],
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

        if (bulkWriteOperations.length) {
            const chunks = this.chunkArray(bulkWriteOperations, 500);
            await this.waitForAllSessionsCommitted();

            let promises = [];
            for (const chunk of chunks) {
                promises.push(this.bulkWrite(chunk));
            }

            await Promise.safeAll(promises);

            promises = [];

            const deleteChunks = this.chunkArray(bulkDeleteOperations, 500);
            for (const chunk of deleteChunks) {
                promises.push(this.bulkWrite(chunk));
            }

            await Promise.safeAll(promises);
        }

        if (Config.DEBUG_LEVEL > DebugLevel.TRACE && Config.DEV_MODE) {
            this.log(
                `Saved ${convertedUnspentTransactions.length} UTXOs, deleted ${convertedSpentTransactions.length} spent UTXOs in ${Date.now() - start}ms`,
            );
        }
    }

    public async deleteGreaterThanBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        if (blockHeight < 0n) {
            try {
                const collection = this.getCollection();

                await collection.deleteMany({}, { session: currentSession });
            } catch (e) {
                this.error(`Failed to delete all UTXOs: ${(e as Error).stack}`);

                throw new Error('Failed to delete all UTXOs');
            }
        } else {
            const criteria: Partial<Filter<IUnspentTransaction>> = {
                blockHeight: { $gte: this.bigIntToLong(blockHeight) },
            };

            await this.delete(criteria, currentSession);
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
        wallet: string,
        filterOrdinals: boolean,
        currentSession?: ClientSession,
    ): Promise<bigint> {
        const aggregation: Document[] = this.balanceOfAggregation.getAggregation(
            this.dbVersion,
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

    public async getWalletUnspentUTXOSFallBack(
        wallet: string,
        optimize: boolean = false,
        olderThan: bigint | undefined,
    ): Promise<RawUTXOsAggregationResultV3> {
        const aggregation: Document[] = this.uxtosAggregation.buildQueryMongodbFallBack(
            wallet,
            true,
            optimize,
            true,
            olderThan,
        );

        const collection = this.getCollection();
        const options = this.getOptions() as AggregateOptions;
        options.allowDiskUse = true;

        try {
            const cursor = collection.aggregate<{
                transactionId: Binary;
                outputIndex: number;
                value: Decimal128;
                scriptPubKey: ShortScriptPubKey;
                raw?: Binary;
            }>(aggregation, options);

            const utxos: RawUTXOsAggregationResultV3['utxos'] = [];
            const rawTxMap = new Map<string, number>();
            const rawTxs: string[] = [];

            for await (const doc of cursor) {
                const txIdHex = doc.transactionId.toString('hex');

                let rawIndex = rawTxMap.get(txIdHex);
                if (rawIndex === undefined && doc.raw) {
                    rawIndex = rawTxs.length;
                    rawTxMap.set(txIdHex, rawIndex);
                    rawTxs.push(doc.raw.toString('base64'));
                }

                utxos.push({
                    transactionId: txIdHex,
                    outputIndex: doc.outputIndex,
                    value: DataConverter.fromDecimal128(doc.value),
                    scriptPubKey: {
                        hex: doc.scriptPubKey.hex.toString('hex'),
                        address: doc.scriptPubKey.address ?? undefined,
                    },
                    raw: rawIndex,
                });
            }

            return { utxos, raw: rawTxs };
        } catch (e) {
            this.error(`Can not fetch UTXOs for wallet ${wallet}: ${(e as Error).stack}`);
            throw e;
        }
    }

    public async getWalletUnspentUTXOS(
        wallet: string,
        optimize: boolean = false,
        olderThan: bigint | undefined,
    ): Promise<RawUTXOsAggregationResultV3> {
        const aggregation: Document[] = this.uxtosAggregation.getAggregation(
            this.dbVersion,
            wallet,
            true,
            optimize,
            true,
            olderThan,
        );

        const collection = this.getCollection();
        const options = this.getOptions() as AggregateOptions;
        options.allowDiskUse = true;

        try {
            const aggregatedDocument = collection.aggregate<UTXOsAggregationResultV3>(
                aggregation,
                options,
            );

            const results: UTXOsAggregationResultV3[] = await aggregatedDocument.toArray();
            if (!results.length) {
                return {
                    utxos: [],
                    raw: [],
                };
            }

            const result = results[0];
            return {
                utxos: result.utxos.map((utxo) => {
                    return {
                        transactionId: utxo.transactionId.toString('hex'),
                        outputIndex: utxo.outputIndex,
                        value: DataConverter.fromDecimal128(utxo.value),
                        scriptPubKey: {
                            hex: utxo.scriptPubKey.hex.toString('hex'),
                            address: utxo.scriptPubKey.address
                                ? utxo.scriptPubKey.address
                                : undefined,
                        },
                        raw: utxo.raw,
                    };
                }),
                raw: result.raw.map((binary) => binary.toString('base64')),
            };
        } catch (e) {
            const msg = (e as Error).message ?? '';
            if (msg.includes('$push used too much memory')) {
                return await this.getWalletUnspentUTXOSFallBack(wallet, optimize, olderThan);
            }

            this.error(`Can not fetch UTXOs for wallet ${wallet}: ${(e as Error).stack}`);

            throw e;
        }
    }

    protected override getCollection(): Collection<IUnspentTransaction> {
        return this._db.collection(OPNetCollections.UnspentTransactions);
    }

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
                            outputIndex: input.outputTransactionIndex || 0,
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
        const spentSet: FastStringMap<IUnspentTransaction> =
            new FastStringMap<IUnspentTransaction>();

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

                    if (
                        output.value.toString() !== '0' &&
                        (output.scriptPubKey.address || output.scriptPubKey.addresses)
                    ) {
                        if (spent) {
                            spent.blockHeight = this.decimal128ToLong(transaction.blockHeight);
                            spent.value = new Long(output.value, true);
                            spent.scriptPubKey = {
                                hex: Binary.createFromHexString(output.scriptPubKey.hex),
                                address: output.scriptPubKey.address ?? null,
                                addresses: output.scriptPubKey.addresses ?? null,
                            };
                        } else {
                            finalList.push({
                                blockHeight: this.decimal128ToLong(transaction.blockHeight),
                                transactionId: transaction.id,
                                outputIndex: output.index,
                                value: new Long(output.value, true),
                                scriptPubKey: {
                                    hex: Binary.createFromHexString(output.scriptPubKey.hex),
                                    address: output.scriptPubKey.address ?? null,
                                    addresses: output.scriptPubKey.addresses ?? null,
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
