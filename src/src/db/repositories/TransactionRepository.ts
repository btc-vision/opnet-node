import { Address } from '@btc-vision/bsi-binary';
import { BaseRepository } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import {
    ClientSession,
    Collection,
    Db,
    Decimal128,
    Document,
    Filter,
    OperationOptions,
    Sort,
} from 'mongodb';
import { UTXOsOutputTransactions } from '../../api/json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    BalanceOfAggregation,
    BalanceOfOutputTransactionFromDB,
} from '../../vm/storage/databases/aggregation/BalanceOfAggregation.js';
import {
    UTXOSAggregation,
    UTXOSOutputTransactionFromDB,
} from '../../vm/storage/databases/aggregation/UTXOSAggregation.js';
import { ITransactionDocument, TransactionDocument } from '../interfaces/ITransactionDocument.js';

export class TransactionRepository extends BaseRepository<
    ITransactionDocument<OPNetTransactionTypes>
> {
    public readonly logColor: string = '#afeeee';

    private readonly uxtosAggregation: UTXOSAggregation = new UTXOSAggregation();
    private readonly balanceOfAggregation: BalanceOfAggregation = new BalanceOfAggregation();

    constructor(db: Db) {
        super(db);
    }

    /** Save block headers */
    public async saveTransaction(
        transactionData: ITransactionDocument<OPNetTransactionTypes>,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<ITransactionDocument<OPNetTransactionTypes>>> = {
            hash: transactionData.hash,
            id: transactionData.id,
            blockHeight: transactionData.blockHeight,
        };

        await this.updatePartial(criteria, transactionData, currentSession);
    }

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
        currentSession?: ClientSession,
    ): Promise<void> {
        const bulkWriteOperations = transactions.map((transaction) => {
            return {
                updateOne: {
                    filter: {
                        hash: transaction.hash,
                        blockHeight: transaction.blockHeight,
                    },
                    update: {
                        $set: transaction,
                    },
                    upsert: true,
                },
            };
        });

        await this.bulkWrite(bulkWriteOperations, currentSession);
    }

    public async getTransactionsByBlockHash(
        height: Decimal128,
        currentSession?: ClientSession,
    ): Promise<TransactionDocument<OPNetTransactionTypes>[]> {
        const criteria: Partial<TransactionDocument<OPNetTransactionTypes>> = {
            blockHeight: height,
        };

        const sort: Sort = { index: 1 };

        return await this.getAll(criteria, currentSession, sort);
    }

    public async getTransactionByHash(
        hash: string,
        currentSession?: ClientSession,
    ): Promise<TransactionDocument<OPNetTransactionTypes> | undefined> {
        const criteria: Document = {
            $or: [{ hash }, { id: hash }],
        };

        const transaction = await this.queryOne(criteria, currentSession);
        delete transaction?._id;

        return transaction ?? undefined;
    }

    public async getBalanceOf(wallet: Address, currentSession?: ClientSession): Promise<bigint> {
        const aggregation: Document[] = this.balanceOfAggregation.getAggregation(wallet);
        const collection = this.getCollection();
        const options: OperationOptions = this.getOptions(currentSession);

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
        _optimize: boolean = false,
        currentSession?: ClientSession,
    ): Promise<UTXOsOutputTransactions> {
        const aggregation: Document[] = this.uxtosAggregation.getAggregation(wallet);
        const collection = this.getCollection();
        const options = this.getOptions(currentSession);

        const aggregatedDocument = collection.aggregate<UTXOSOutputTransactionFromDB>(
            aggregation,
            options,
        );
        const results: UTXOSOutputTransactionFromDB[] = await aggregatedDocument.toArray();

        return results.map((result) => {
            return {
                transactionId: result.transactionId,
                outputIndex: result.outputIndex,
                value: DataConverter.fromDecimal128(result.value),
                scriptPubKey: result.scriptPubKey,
            };
        });
    }

    protected override getCollection(): Collection<ITransactionDocument<OPNetTransactionTypes>> {
        return this._db.collection('Transactions');
    }
}
