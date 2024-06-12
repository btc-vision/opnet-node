import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedUsedWbtcUtxo extends IndexedCollection<OPNetCollections.USED_WBTC_UTXO> {
    constructor() {
        super(OPNetCollections.USED_WBTC_UTXO);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { vault: 1 }, name: 'vault_1' },
            { key: { hash: 1 }, name: 'hash_1' },
            {
                key: { vault: 1, hash: 1 },
                name: 'vault_1_hash_1',
            },
        ];
    }
}
