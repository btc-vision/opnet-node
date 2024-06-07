import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedMempool extends IndexedCollection<OPNetCollections.Mempool> {
    constructor() {
        super(OPNetCollections.Mempool);
    }

    public getIndexes(): IndexDescription[] {
        return [];
    }
}
