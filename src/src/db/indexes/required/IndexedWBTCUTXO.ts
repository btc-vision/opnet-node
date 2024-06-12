import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedWBTCUTXO extends IndexedCollection<OPNetCollections.WBTCUTXO> {
    constructor() {
        super(OPNetCollections.WBTCUTXO);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { blockId: 1 }, name: 'blockId_1' },
            { key: { vault: 1 }, name: 'vault_1' },
            { key: { hash: 1 }, name: 'hash_1' },
            { key: { amount: 1 }, name: 'amount_1' },
        ];
    }
}
