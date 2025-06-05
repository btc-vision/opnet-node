import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedAnyoneCanSpend extends IndexedCollection<OPNetCollections.AnyoneCanSpend> {
    constructor() {
        super(OPNetCollections.AnyoneCanSpend);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { txid: 1 }, name: 'txid_1' },
            { key: { vout: 1 }, name: 'vout_1' },
        ];
    }
}
