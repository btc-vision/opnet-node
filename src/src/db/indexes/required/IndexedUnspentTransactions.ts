import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedUnspentTransactions extends IndexedCollection<OPNetCollections.UnspentTransactions> {
    constructor() {
        super(OPNetCollections.UnspentTransactions);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { blockHeight: 1 }, name: 'blockHeight_1' },
            {
                key: { transactionId: 'hashed', outputIndex: 1 },
                name: 'transactionId_hashed_outputIndex_1',
            },
            { key: { deletedAtBlock: 1 }, name: 'deletedAtBlock_1' },
            {
                key: { 'scriptPubKey.address': 'hashed' },
                name: 'address_hashed',
            },
        ];
    }
}
