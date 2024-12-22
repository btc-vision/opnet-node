import { Document } from 'mongodb';
import { UTXOsAggregationV2 } from './UTXOsAggregationV2.js';

export class BalanceOfAggregationV2 extends UTXOsAggregationV2 {
    public getAggregation(wallet: string, filterOrdinals: boolean = true): Document[] {
        const aggregation: Document[] = super.getAggregation(wallet, false, filterOrdinals, false);

        aggregation.push({
            $group: {
                _id: 0,
                balance: {
                    $sum: {
                        $toDecimal: '$value',
                    },
                },
            },
        });

        return aggregation;
    }
}
