import { Address } from '@btc-vision/bsi-binary';
import { Document, Long } from 'mongodb';
import { Aggregation } from './Aggregation.js';

export class UTXOsAggregationV2 extends Aggregation {
    constructor() {
        super();
    }

    public getAggregation(
        wallet: Address,
        limit: boolean = true,
        optimize: boolean = false,
    ): Document[] {
        const minValue: number = optimize ? 20000 : 330;

        const aggregation: Document[] = [
            {
                $match: {
                    'outputs.scriptPubKey.address': wallet,
                    value: Long.fromValue(minValue),
                },
            },
        ];

        if (limit) {
            aggregation.push({
                $limit: 1000,
            });
        }

        aggregation.push({
            $project: {
                _id: 0,
                transactionId: 1,
                outputIndex: 1,
                value: 1,
                scriptPubKey: 1,
            },
        });

        return aggregation;
    }
}
