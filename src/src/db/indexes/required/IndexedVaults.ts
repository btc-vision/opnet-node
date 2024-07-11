import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedVaults extends IndexedCollection<OPNetCollections.Vaults> {
    constructor() {
        super(OPNetCollections.Vaults);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { vault: 1 }, name: 'vault_1' },
            { key: { firstSeen: 1 }, name: 'firstSeen_1' },
            { key: { minimum: 1 }, name: 'minimum_1' },
        ];
    }
}
