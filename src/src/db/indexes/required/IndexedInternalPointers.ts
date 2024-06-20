import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedInternalPointers extends IndexedCollection<OPNetCollections.InternalPointers> {
    constructor() {
        super(OPNetCollections.InternalPointers);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { _id: 1 }, name: '_id_' },
            {
                key: { contractAddress: 1, pointer: 1, lastSeenAt: 1 },
                name: 'contractAddress_1_pointer_1_lastSeenAt_1',
            },
            {
                key: { contractAddress: 1, pointer: 1 },
                name: 'contractAddress_1_pointer_1',
            },
            { key: { lastSeenAt: 1 }, name: 'lastSeenAt_1' },
        ];
    }
}
