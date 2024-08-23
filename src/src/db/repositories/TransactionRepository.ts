import { BaseRepository } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import { ClientSession, Collection, Db, Decimal128, Document, Filter, Sort } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { ITransactionDocument, TransactionDocument } from '../interfaces/ITransactionDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';

export class TransactionRepository extends BaseRepository<
    ITransactionDocument<OPNetTransactionTypes>
> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async deleteTransactionsFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<ITransactionDocument<OPNetTransactionTypes>>> = {
            blockHeight: { $gte: DataConverter.toDecimal128(blockHeight) },
        };

        const promises: Promise<unknown>[] = [this.delete(criteria, currentSession)];

        await Promise.all(promises);
    }

    public async saveTransaction(
        transactionData: ITransactionDocument<OPNetTransactionTypes>,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<ITransactionDocument<OPNetTransactionTypes>>> = {
            hash: transactionData.hash,
            id: transactionData.id,
            blockHeight: transactionData.blockHeight,
        };

        const promises: Promise<unknown>[] = [
            this.updatePartial(criteria, transactionData, currentSession),
        ];

        await Promise.all(promises);
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

        const promises: Promise<unknown>[] = [this.bulkWrite(bulkWriteOperations, currentSession)];

        await Promise.all(promises);
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

    protected override getCollection(): Collection<ITransactionDocument<OPNetTransactionTypes>> {
        return this._db.collection(OPNetCollections.Transactions);
    }
}
