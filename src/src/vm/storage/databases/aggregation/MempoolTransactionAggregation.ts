import { Document } from 'mongodb';
import { Aggregation } from './Aggregation.js';

export interface MempoolTransactionAggregationOutput {
    readonly ids: string[];
}

export class MempoolTransactionAggregation extends Aggregation {
    public getAggregation(isNot: string[]): Document[] {
        return [
            {
                $match: {
                    id: {
                        $in: isNot,
                    },
                },
            },
            {
                $group: {
                    _id: 'txs',
                    ids: {
                        $push: '$id',
                    },
                },
            },
        ];
    }
}
