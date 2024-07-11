import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedBlockchainInformation extends IndexedCollection<OPNetCollections.BlockchainInformation> {
    constructor() {
        super(OPNetCollections.BlockchainInformation);
    }

    public getIndexes(): IndexDescription[] {
        return [];
    }
}
