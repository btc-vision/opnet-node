import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedMLDSAPublicKeys extends IndexedCollection<OPNetCollections.MLDSAPublicKeys> {
    constructor() {
        super(OPNetCollections.MLDSAPublicKeys);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { hashedPublicKey: 1 }, unique: true, name: 'hashedPublicKey_1' },
            { key: { legacyPublicKey: 1 }, unique: true, name: 'legacyPublicKey_1' },
            { key: { tweakedPublicKey: 1 }, unique: true, name: 'tweakedPublicKey_1' },
            { key: { blockHeight: 1 }, name: 'blockHeight_1' },
        ];
    }
}
