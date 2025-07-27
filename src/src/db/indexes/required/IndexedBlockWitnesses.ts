import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedBlockWitnesses extends IndexedCollection<OPNetCollections.BlockWitnesses> {
    constructor() {
        super(OPNetCollections.BlockWitnesses);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { _id: 1 }, name: '_id_' },
            { key: { blockNumber: 1 }, name: 'blockNumber_1' },
            { key: { identity: 1 }, name: 'identity_1' },
            { key: { trusted: 1 }, name: 'trusted_1' },
            {
                key: {
                    blockNumber: 1,
                    opnetPubKey: 1,
                    signature: 1,
                },
            },
        ];
    }
}
