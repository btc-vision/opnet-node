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
                    id: 1,
                },
                unique: true,
                name: 'id_1',
            },

            {
                key: {
                    previousPsbtId: 1,
                },
                name: 'psbtId_1',
            },

            {
                key: {
                    blockHeight: 1,
                },
                name: 'blockHeight_1',
            },

            {
                key: {
                    'outputs.address': 1,
                    id: 1,
                },
                name: 'outputs_address_1_id_1',
            },

            {
                key: {
                    'inputs.transactionId': 1,
                },
                name: 'inputs_transactionId_1',
            },

            {
                key: {
                    'inputs.transactionId': 1,
                    'inputs.outputIndex': 1,
                },
                name: 'inputs_transactionId_1_outputIndex_1',
            },

            {
                key: {
                    isOPNet: 1,
                },
                name: 'isOPNet_1',
            },
        ];
    }
}
