import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedContracts extends IndexedCollection<OPNetCollections.Contracts> {
    constructor() {
        super(OPNetCollections.Contracts);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { _id: 1 }, name: '_id_' },
            { key: { contractAddress: 1 }, name: 'contractAddress_1' },
            { key: { virtualAddress: 1 }, name: 'virtualAddress_1' },
            { key: { blockHeight: 1 }, name: 'blockHeight_1' },
        ];
    }
}