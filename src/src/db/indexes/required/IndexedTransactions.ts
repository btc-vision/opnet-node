import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedTransactions extends IndexedCollection<OPNetCollections.Transactions> {
    constructor() {
        super(OPNetCollections.Transactions);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { _id: 1 }, name: '_id_' },
            { key: { blockHeight: 1 }, name: 'blockHeight_1' },
            { key: { hash: 1 }, name: 'hash_1' },
            { key: { id: 1 }, name: 'id_1' },
            /*{
                key: { 'inputs.originalTransactionId': 1 },
                name: 'inputs.originalTransactionId_1',
            },
            {
                key: { 'outputs.scriptPubKey.address': 1 },
                name: 'outputs.scriptPubKey.address_1',
            },
            {
                key: { 'outputs.scriptPubKey.addresses': 1 },
                name: 'outputs.scriptPubKey.addresses_1',
            },*/
            {
                key: { hash: 1, blockHeight: 1 },
                name: 'hash_1_blockHeight_1',
            },
        ];
    }
}
