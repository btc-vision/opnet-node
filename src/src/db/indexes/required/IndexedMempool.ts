import { IndexDescription } from 'mongodb';
import { IndexedCollection, OPNetCollections } from './IndexedCollection.js';

export class IndexedMempool extends IndexedCollection<OPNetCollections.Mempool> {
    constructor() {
        super(OPNetCollections.Mempool);
    }

    public getIndexes(): IndexDescription[] {
        return [
            {
                key: {
                    identifier: 1,
                    psbt: 1,
                },
                unique: true,
                name: 'identifier_psbt_1',
            },
            {
                key: {
                    id: 1,
                },
                name: 'id_1',
            },
            {
                key: {
                    previousPsbtId: 1,
                },
                name: 'psbtId_1',
            },
        ];
    }
}
