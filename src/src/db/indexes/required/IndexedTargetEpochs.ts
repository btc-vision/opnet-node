import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedTargetEpochs extends IndexedCollection<OPNetCollections.TargetEpochs> {
    constructor() {
        super(OPNetCollections.TargetEpochs);
    }

    public getIndexes(): IndexDescription[] {
        return [
            { key: { difficulty: 1 }, name: 'difficulty_1' },
            { key: { mldsaPublicKey: 1 }, name: 'mldsaPublicKey_1' },
            // Enforce one document per (epoch, salt, mldsaPublicKey), the same key
            // saveTargetEpoch upserts on, so a concurrent double-submit cannot race
            // two rows in (the read-then-upsert guard alone is TOCTOU). Also indexes
            // the epochNumber-scoped dedup/count queries.
            // NOTE: if the collection already holds duplicate tuples (from before the
            // dedup guard was fixed), this build will fail and be logged; dedup the
            // collection once, then it applies. Replaces the old `targetEpoch_1` index
            // which was keyed on a non-existent field.
            {
                key: { epochNumber: 1, salt: 1, mldsaPublicKey: 1 },
                name: 'epochNumber_salt_mldsaPublicKey_unique',
                unique: true,
            },
        ];
    }
}
