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
                key: { transactionId: 1, outputIndex: 1 },
                name: 'transactionId_1_outputIndex_1',
            },
            { key: { deletedAtBlock: 1 }, name: 'deletedAtBlock_1' },
            {
                key: { 'scriptPubKey.address': 1 },
                name: 'address_1',
            },
        ];
    }
}
