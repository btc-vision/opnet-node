import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedWBTCUTXO extends IndexedCollection<OPNetCollections.WBTCUTXO> {
    constructor() {
        super(OPNetCollections.WBTCUTXO);
    }

    public getIndexes(): IndexDescription[] {
        return [];
    }
}
