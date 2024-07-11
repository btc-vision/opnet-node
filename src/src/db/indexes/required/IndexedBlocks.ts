import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedBlocks extends IndexedCollection<OPNetCollections.Blocks> {
    constructor() {
        super(OPNetCollections.Blocks);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { _id: 1 }, name: '_id_' },
            { key: { hash: 1 }, name: 'hash_1' },
            { key: { height: 1 }, name: 'height_1' },
        ];
    }
}
