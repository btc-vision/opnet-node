import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedPublicKeys extends IndexedCollection<OPNetCollections.PublicKeys> {
    constructor() {
        super(OPNetCollections.PublicKeys);
    }

    public getIndexes(): IndexDescription[] {
        return [{ key: { blockHeight: 1 }, name: 'blockHeight_1' }];
    }
}
