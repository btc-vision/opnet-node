import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedReorgs extends IndexedCollection<OPNetCollections.Reorgs> {
    constructor() {
        super(OPNetCollections.Reorgs);
    }

    public getIndexes(): IndexDescription[] {
        return [];
    }
}
