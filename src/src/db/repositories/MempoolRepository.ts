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
import { Address } from '@btc-vision/bsi-binary';

export class MempoolRepository extends BaseRepository<IMempoolTransaction> {
    public readonly logColor: string = '#afeeee';

    private readonly unspentTransactionMempoolAggregation: MempoolTransactionAggregation =
        new MempoolTransactionAggregation();

    public constructor(db: Db) {
        super(db);
    }

    public async getTransactionByIdentifier(
        transactionIdentifier: bigint,
        psbt: boolean,
        id?: string | null,
    ): Promise<IMempoolTransactionObj | undefined> {
        const criteria: Filter<IMempoolTransaction> = {
            identifier: this.bigIntToBinary(transactionIdentifier),
            psbt: psbt,
        };

        if (id) {
            criteria.id = id;
        }

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

    public async hasTransactionByIdentifier(
        transactionIdentifier: bigint,
        psbt: boolean,
    ): Promise<boolean> {
        const result = await this.getTransactionByIdentifier(transactionIdentifier, psbt);

        return !!result;
    }

    public async storeTransactions(txs: IMempoolTransactionObj[]): Promise<void> {
        const batch = 100;

        for (let i = 0; i < txs.length; i += batch) {
            const batchTxs = txs.slice(i, i + batch);
            const promises = batchTxs.map((tx) => {
                return this.storeTransaction(tx);
            });

            await Promise.all(promises);
        }
    }

    public async storeIfNotExists(transaction: IMempoolTransactionObj): Promise<boolean> {
        const exists = await this.getTransactionByIdentifier(
            transaction.identifier,
            transaction.psbt,
        );

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

    public async deleteTransactionByIdentifier(
        transactionIdentifier: bigint,
        psbt: boolean,
    ): Promise<boolean> {
        const filter: Filter<IMempoolTransaction> = {
            identifier: this.bigIntToBinary(transactionIdentifier),
            psbt: psbt,
        };

        try {
            await this.delete(filter);
            return true;
        } catch (e) {
            return false;
        }
    }

    public async getAllTransactionIncluded(txList: string[]): Promise<string[]> {
        const aggregation = this.unspentTransactionMempoolAggregation.getAggregation(txList);

        const collection = this.getCollection();
        const options: AggregateOptions = this.getOptions() as AggregateOptions;
        options.allowDiskUse = true;

        const aggregatedDocument = collection.aggregate<MempoolTransactionAggregationOutput>(
            aggregation,
            options,
        );

        const results: MempoolTransactionAggregationOutput[] = await aggregatedDocument.toArray();
        const result = results[0];

        return result ? result.ids : [];
    }

    public async storeTransaction(transaction: IMempoolTransactionObj): Promise<boolean> {
        const data: IMempoolTransaction = this.convertToDb(transaction);
        const filter: Filter<IMempoolTransaction> = {
            identifier: data.identifier,
            psbt: data.psbt,
        };

        try {
            await this.updatePartialWithFilter(filter, {
                $set: data,
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    public async getPendingTransactions(address: Address): Promise<UTXOSOutputTransaction[]> {
        const criteria: Filter<IMempoolTransaction> = {
            'outputs.address': address,
            id: {
                $exists: true,
            },
        };

        const collection = this.getCollection();
        const options: FindOptions = this.getOptions();
        options.allowDiskUse = true;
        options.limit = 100;

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
                    });
                }
            }
        }

        return utxos;
    }

    public async fetchSpentUnspentTransactions(
        txs: UTXOSOutputTransaction[],
    ): Promise<UTXOSOutputTransaction[]> {
        const aggregation: Document[] = [
            {
                $match: {
                    'inputs.transactionId': {
                        $in: txs.map((tx) => tx.transactionId),
                    },
                },
            },

            {
                $limit: 100,
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
                const tx = txs.find((tx) => tx.transactionId === input.transactionId);
                if (!tx) continue;

                utxos.push(tx);
            }
        }

        return utxos;
    }

    protected override getCollection(): Collection<IMempoolTransaction> {
        return this._db.collection(OPNetCollections.Mempool);
    }

    private bigintToBuffer(bigInt: bigint): Buffer {
        return Buffer.from(bigInt.toString(16), 'hex');
    }

    private bigIntToBinary(bigInt: bigint): Binary {
        return new Binary(this.bigintToBuffer(bigInt));
    }

    private bufferToBigInt(buffer: Buffer): bigint {
        return BigInt(`0x${buffer.toString('hex')}`);
    }

    private binaryToBigInt(binary: Binary): bigint {
        return this.bufferToBigInt(Buffer.from(binary.buffer));
    }

    private convertToDb(data: IMempoolTransactionObj): IMempoolTransaction {
        return {
            ...data,
            identifier: this.bigIntToBinary(data.identifier),
            data: new Binary(data.data),
            blockHeight: DataConverter.toDecimal128(data.blockHeight),
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
            identifier: this.binaryToBigInt(data.identifier),
            data: data.data.buffer,
            blockHeight: DataConverter.fromDecimal128(data.blockHeight),
            inputs: data.inputs.map((input) => {
                return {
                    transactionId: input.transactionId,
                    outputIndex: input.outputIndex,
                };
            }),
            outputs: data.outputs.map((output) => {
                return {
                    data: output.data.buffer,
                    outputIndex: output.outputIndex,
                    value:
                        output.value instanceof Long ? output.value : Long.fromNumber(output.value),
                    address: output.address,
                };
            }),
        };
    }
}
