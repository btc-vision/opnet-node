import { AnyBulkWriteOperation, Collection, Db } from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { ExtendedBaseRepository } from './ExtendedBaseRepository.js';
import { Classification } from '../../blockchain-indexer/sync/solver/UTXOSorter.js';

export class AnyoneCanSpendRepository extends ExtendedBaseRepository<Classification> {
    public readonly logColor: string = '#afeeee';

    public constructor(db: Db) {
        super(db);
    }

    public async tagAnyoneCanSpend(txs: Classification[]): Promise<void> {
        console.log('tagAnyoneCanSpend', txs);

        const collection = this.getCollection();
        const operations: AnyBulkWriteOperation<Classification>[] = txs.map((tx) => {
            return {
                updateOne: {
                    filter: { txid: tx.outpoint.txid, vout: tx.outpoint.index },
                    update: { $set: { ...tx, outpoint: undefined } },
                    upsert: true, // Use upsert to insert if it doesn't exist
                },
            };
        });

        const result = await collection.bulkWrite(operations, {
            ordered: true,
            writeConcern: { w: 1 },
        });

        this.success(`Upserted ${result.upsertedCount} transactions.`);
    }

    protected override getCollection(): Collection<Classification> {
        return this._db.collection(OPNetCollections.AnyoneCanSpend);
    }
}
