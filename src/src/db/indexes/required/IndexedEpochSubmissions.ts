import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedEpochSubmissions extends IndexedCollection<OPNetCollections.EpochSubmissions> {
    constructor() {
        super(OPNetCollections.EpochSubmissions);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { epochNumber: 1 }, name: 'epochNumber_1' },
            { key: { startBlock: 1 }, name: 'startBlock_1' },
            { key: { submissionHash: 1 }, name: 'submissionHash_1' },
            {
                key: { epochNumber: 1, 'epochProposed.publicKey': 1, 'epochProposed.salt': 1 },
                name: 'epochNumber_1_epochProposedPublicKey_1_epochProposedSalt_1',
            },
        ];
    }
}
