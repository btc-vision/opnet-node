import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedEpochs extends IndexedCollection<OPNetCollections.Epochs> {
    constructor() {
        super(OPNetCollections.Epochs);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { epochNumber: 1 }, name: 'epochNumber_1' },
            { key: { epochHash: 1 }, name: 'epochHash_1' },
            { key: { targetHash: 1 }, name: 'targetHash_1' },
            { key: { startBlock: 1 }, name: 'startBlock_1' },
            { key: { endBlock: 1 }, name: 'endBlock_1' },
            { key: { 'proposer.mldsaPublicKey': 1 }, name: 'mldsaPublicKey_1' },
            { key: { 'proposer.salt': 1 }, name: 'salt_1' },
        ];
    }
}
