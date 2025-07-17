import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedTargetEpochs extends IndexedCollection<OPNetCollections.TargetEpochs> {
    constructor() {
        super(OPNetCollections.TargetEpochs);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { targetEpoch: 1 }, name: 'targetEpoch_1' },
            { key: { difficulty: 1 }, name: 'difficulty_1' },
        ];
    }
}
