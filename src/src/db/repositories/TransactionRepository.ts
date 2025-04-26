import { BaseRepository, DataAccessError, DataAccessErrorType } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import {
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
    Sort,
} from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { ITransactionDocument, TransactionDocument } from '../interfaces/ITransactionDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';

/**
 * Reworked repository that stores hash/id purely as binary.
 */
export class TransactionRepository extends BaseRepository<
    ITransactionDocument<OPNetTransactionTypes>
> {
    public readonly logColor: string = '#afeeee';

    public constructor(db: Db) {
        super(db);
    }

    /**
     * Removes all transactions from the given blockHeight onward.
     */
    public async deleteTransactionsFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<ITransactionDocument<OPNetTransactionTypes>>> = {
            blockHeight: { $gte: DataConverter.toDecimal128(blockHeight) },
        };

        await this.delete(criteria, currentSession);
    }

    /**
     * Internal method to run bulkWrite operations.
     * Everything is already expected to be in binary form (hash/id).
     */
    public async bulkWrite(
        operations: AnyBulkWriteOperation<ITransactionDocument<OPNetTransactionTypes>>[],
    ): Promise<void> {
        try {
            const collection = this.getCollection();
            const options: BulkWriteOptions = this.getOptions();
            options.ordered = true;
            options.writeConcern = { w: 1 };
            options.maxTimeMS = 512_000;
            options.timeoutMS = 512_000;

            const result: BulkWriteResult = await collection.bulkWrite(operations, options);

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

    /**
     * Saves or upserts a set of transactions to MongoDB.
     * Expects that the transaction.hash and transaction.id are already binary.
     */
    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
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

        await this.bulkWrite(bulkWriteOperations);
    }

    /**
     * Retrieves all transactions for a given blockHeight.
     * `height` is Decimal128, so we can filter directly by blockHeight.
     */
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

    /**
     * Retrieves a single transaction by its hash or id (both are stored as binary).
     *
     * If you still have external code that provides the hash as a hex string,
     * you must convert it to Binary/Buffer here.
     *
     * @param hashOrId - a Buffer or a string (hex) to be matched against `hash` or `id` in binary form
     * @param currentSession
     */
    public async getTransactionByHash(
        hashOrId: Buffer | string,
        currentSession?: ClientSession,
    ): Promise<TransactionDocument<OPNetTransactionTypes> | undefined> {
        // If `hashOrId` is string (hex?), convert to a Buffer. Then wrap in Binary to query.
        let binHash: Binary;
        if (typeof hashOrId === 'string') {
            binHash = new Binary(Buffer.from(hashOrId, 'hex'));
        } else {
            binHash = new Binary(hashOrId);
        }

        const criteria: Document = {
            $or: [{ hash: binHash }, { id: binHash }],
        };

        const transaction = await this.queryOne(criteria, currentSession);
        delete transaction?._id;

        return transaction ?? undefined;
    }

    /**
     * We override getCollection to ensure we get the right collection with correct typing.
     */
    protected override getCollection(): Collection<ITransactionDocument<OPNetTransactionTypes>> {
        return this._db.collection(OPNetCollections.Transactions);
    }
}
