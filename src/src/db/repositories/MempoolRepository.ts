import { BaseRepository } from '@btc-vision/bsi-common';
import {
    AggregateOptions,
    Binary,
    Collection,
    Db,
    Document,
    Filter,
    FindOptions,
    Long,
} from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { IMempoolTransaction, IMempoolTransactionObj } from '../interfaces/IMempoolTransaction.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { Config } from '../../config/Config.js';
import {
    MempoolTransactionAggregation,
    MempoolTransactionAggregationOutput,
} from '../../vm/storage/databases/aggregation/MempoolTransactionAggregation.js';
import { UTXOSOutputTransaction } from '../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';

export class MempoolRepository extends BaseRepository<IMempoolTransaction> {
    public readonly logColor: string = '#afeeee';

    private readonly unspentTransactionMempoolAggregation: MempoolTransactionAggregation =
        new MempoolTransactionAggregation();

    public constructor(db: Db) {
        super(db);
    }

    public async getTransactionById(id: string): Promise<IMempoolTransactionObj | undefined> {
        const criteria: Filter<IMempoolTransaction> = {
            id: id,
        };

        const result = await this.queryOne(criteria);
        if (!result) {
            return;
        }

        return this.convertToObj(result);
    }

    public async purgeOldTransactions(currentBlock: bigint): Promise<void> {
        // If the transaction is older than 20 blocks, we must purge it.
        const criteria: Filter<IMempoolTransaction> = {
            blockHeight: {
                $lt: DataConverter.toDecimal128(
                    currentBlock - BigInt(Config.MEMPOOL.EXPIRATION_BLOCKS),
                ),
            },
        };

        await this.delete(criteria);
    }

    public async deleteGreaterThanBlockHeight(blockHeight: bigint): Promise<void> {
        if (blockHeight <= 0) {
            try {
                const collection = this.getCollection();
                await collection.deleteMany({});
            } catch (e) {
                this.error(`Error deleting mempool transactions: ${e}`);

                throw new Error('Error deleting mempool transactions');
            }
        } else {
            const criteria: Filter<IMempoolTransaction> = {
                blockHeight: {
                    $gt: DataConverter.toDecimal128(blockHeight),
                },
            };

            await this.delete(criteria);
        }
    }

    public async hasTransactionById(id: string): Promise<boolean> {
        const result = await this.getTransactionById(id);

        return !!result;
    }

    public async getAllTransactionIds(): Promise<string[]> {
        const collection = this.getCollection();
        return await collection
            .find({}, { projection: { id: 1, _id: 0 } })
            .map((doc) => doc.id)
            .toArray();
    }

    public async findConflictingTransactions(
        transaction: IMempoolTransactionObj,
    ): Promise<IMempoolTransactionObj[]> {
        const orConditions: Filter<IMempoolTransaction>[] = transaction.inputs.map((input) => ({
            inputs: {
                $elemMatch: { transactionId: input.transactionId, outputIndex: input.outputIndex },
            },
        }));

        if (!orConditions.length) return [];

        const collection = this.getCollection();
        const criteria: Filter<IMempoolTransaction> = { $or: orConditions };
        const results = (await collection.find(criteria).toArray()) as IMempoolTransaction[];

        return results.map(this.convertToObj).filter((t) => t.id !== transaction.id);
    }

    public async findDirectDescendants(id: string): Promise<IMempoolTransactionObj[]> {
        const criteria: Filter<IMempoolTransaction> = { 'inputs.transactionId': id };
        const results = (await this.getCollection()
            .find(criteria)
            .toArray()) as IMempoolTransaction[];

        return results.map(this.convertToObj);
    }

    public async storeTransactions(txs: IMempoolTransactionObj[]): Promise<void> {
        const batch = 100;

        for (let i = 0; i < txs.length; i += batch) {
            const batchTxs = txs.slice(i, i + batch);
            const promises = batchTxs.map((tx) => {
                return this.storeTransaction(tx);
            });

            await Promise.safeAll(promises);
        }
    }

    public async storeIfNotExists(transaction: IMempoolTransactionObj): Promise<boolean> {
        const exists = await this.getTransactionById(transaction.id);

        if (!exists) {
            await this.storeTransaction(transaction);
        }

        return !!exists;
    }

    public async deleteTransactionsById(ids: string[]): Promise<void> {
        // If the transaction is older than 20 blocks, we must purge it.
        const criteria: Filter<IMempoolTransaction> = {
            id: {
                $in: ids,
            },
        };

        await this.delete(criteria);
    }

    public async deleteTransactionByIdentifier(id: string, psbt: boolean): Promise<boolean> {
        const filter: Filter<IMempoolTransaction> = {
            id: id,
        };

        try {
            await this.delete(filter);
            return true;
        } catch (e) {
            return false;
        }
    }

    public async getAllTransactionIncluded(txList: string[]): Promise<string[]> {
        try {
            const aggregation = this.unspentTransactionMempoolAggregation.getAggregation(txList);

            const collection = this.getCollection();
            const options: AggregateOptions = this.getOptions() as AggregateOptions;
            options.allowDiskUse = true;

            const aggregatedDocument = collection.aggregate<MempoolTransactionAggregationOutput>(
                aggregation,
                options,
            );

            const results: MempoolTransactionAggregationOutput[] =
                await aggregatedDocument.toArray();

            const result = results[0];

            return result ? result.ids : [];
        } catch {
            return []; // will store all transactions
        }
    }

    public async storeTransaction(transaction: IMempoolTransactionObj): Promise<boolean> {
        const data: IMempoolTransaction = this.convertToDb(transaction);
        const filter: Filter<IMempoolTransaction> = {
            id: data.id,
        };

        try {
            await this.updatePartialWithFilter(filter, {
                $set: data,
            });

            return true;
        } catch (e) {
            if (Config.DEV_MODE) {
                this.fail(`Error storing mempool transaction: ${e}`);
            }

            return false;
        }
    }

    public async getPendingTransactions(address: string): Promise<UTXOSOutputTransaction[]> {
        const criteria: Filter<IMempoolTransaction> = {
            'outputs.address': address,
            id: {
                $exists: true,
            },
        };

        const collection = this.getCollection();
        const options: FindOptions = this.getOptions();
        options.allowDiskUse = true;
        options.limit = Config.API.UTXO_LIMIT;

        const results = (await collection
            .find(criteria, options)
            .toArray()) as IMempoolTransaction[];

        if (!results) {
            return [];
        }

        const utxos: UTXOSOutputTransaction[] = [];
        for (const result of results) {
            if (!result.id) continue;

            for (const output of result.outputs) {
                if (output.address === address) {
                    utxos.push({
                        transactionId: result.id,
                        outputIndex: output.outputIndex,
                        scriptPubKey: {
                            hex: output.data.toString('hex'),
                            address: output.address,
                        },
                        value:
                            output.value instanceof Long
                                ? output.value.toBigInt()
                                : BigInt(output.value),
                        raw: result.data.toString('base64'),
                    });
                }
            }
        }

        return utxos;
    }

    public async fetchSpentUnspentTransactions(
        txs: UTXOSOutputTransaction[],
    ): Promise<UTXOSOutputTransaction[]> {
        const list = txs.map((tx) => tx.transactionId);
        const aggregation: Document[] = [
            {
                $match: {
                    'inputs.transactionId': {
                        $in: list,
                    },
                },
            },
            {
                $limit: Config.API.UTXO_LIMIT,
            },
        ];

        const collection = this.getCollection();
        const options: AggregateOptions = this.getOptions() as AggregateOptions;
        options.allowDiskUse = true;

        const aggregatedDocument = collection.aggregate<IMempoolTransaction>(aggregation, options);
        const results: IMempoolTransaction[] = await aggregatedDocument.toArray();
        const utxos: UTXOSOutputTransaction[] = [];

        for (const result of results) {
            for (const input of result.inputs) {
                const tx = txs.find(
                    (tx) =>
                        tx.transactionId === input.transactionId &&
                        tx.outputIndex === input.outputIndex,
                );

                if (!tx) continue;

                utxos.push(tx);
            }
        }

        return utxos;
    }

    protected override getCollection(): Collection<IMempoolTransaction> {
        return this._db.collection(OPNetCollections.Mempool);
    }

    private convertToDb(data: IMempoolTransactionObj): IMempoolTransaction {
        return {
            ...data,
            data: new Binary(data.data),
            blockHeight: DataConverter.toDecimal128(data.blockHeight),
            theoreticalGasLimit: Long.fromBigInt(data.theoreticalGasLimit),
            priorityFee: Long.fromBigInt(data.priorityFee),
            isOPNet: data.isOPNet || false,
            inputs: data.inputs.map((input) => {
                return {
                    transactionId: input.transactionId,
                    outputIndex: input.outputIndex,
                };
            }),
            outputs: data.outputs.map((output) => {
                return {
                    data: new Binary(output.data),
                    outputIndex: output.outputIndex,
                    value: output.value,
                    address: output.address,
                };
            }),
        };
    }

    private convertToObj(data: IMempoolTransaction): IMempoolTransactionObj {
        return {
            ...data,
            data: Buffer.from(data.data.buffer),
            blockHeight: DataConverter.fromDecimal128(data.blockHeight),
            theoreticalGasLimit: Long.isLong(data.theoreticalGasLimit)
                ? data.theoreticalGasLimit.toBigInt()
                : BigInt(`${data.theoreticalGasLimit}`),
            isOPNet: data.isOPNet || false,
            priorityFee: Long.isLong(data.priorityFee) ? data.priorityFee.toBigInt() : BigInt(0),
            inputs: data.inputs.map((input) => {
                return {
                    transactionId: input.transactionId,
                    outputIndex: input.outputIndex,
                };
            }),
            outputs: data.outputs.map((output) => {
                return {
                    data: Buffer.from(output.data.buffer),
                    outputIndex: output.outputIndex,
                    value:
                        output.value instanceof Long ? output.value : Long.fromNumber(output.value),
                    address: output.address,
                };
            }),
        };
    }
}
