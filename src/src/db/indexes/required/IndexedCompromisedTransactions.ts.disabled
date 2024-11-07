import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedCompromisedTransactions extends IndexedCollection<OPNetCollections.CompromisedTransactions> {
    constructor() {
        super(OPNetCollections.CompromisedTransactions);
    }

    public getIndexes(): IndexDescription[] {
        return [
            {
                key: {
                    height: 1,
                },
                name: 'height_1',
            },
            {
                key: {
                    id: 1,
                },
                name: 'id_1',
            },
        ];
    }
}
