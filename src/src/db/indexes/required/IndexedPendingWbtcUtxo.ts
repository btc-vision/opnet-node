import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedPendingWbtcUtxo extends IndexedCollection<OPNetCollections.PENDING_WBTC_UTXO> {
    constructor() {
        super(OPNetCollections.PENDING_WBTC_UTXO);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { vault: 1 }, name: 'vault_1' },
            { key: { hash: 1 }, name: 'hash_1' },
            { key: { amount: 1 }, name: 'amount_1' },
        ];
    }
}
