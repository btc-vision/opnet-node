import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedPublicKeys extends IndexedCollection<OPNetCollections.PublicKeys> {
    constructor() {
        super(OPNetCollections.PublicKeys);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { publicKey: 1 }, name: 'publicKey_1' },
            { key: { tweakedPublicKey: 1 }, name: 'tweakedPublicKey_1', unique: true },

            { key: { p2op: 1 }, name: 'p2op_1' },
            { key: { p2tr: 1 }, name: 'p2tr_1', unique: true },
            { key: { p2pkh: 1 }, name: 'p2pkh_1' },
            { key: { p2shp2wpkh: 1 }, name: 'p2shp2wpkh_1' },
            { key: { p2wpkh: 1 }, name: 'p2wpkh_1' },
            { key: { p2pkhHybrid: 1 }, name: 'p2pkhHybrid_1' },
            { key: { p2pkhUncompressed: 1 }, name: 'p2pkhUncompressed_1' },
        ];
    }
}
