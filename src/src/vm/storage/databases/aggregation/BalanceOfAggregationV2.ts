import { Address } from '@btc-vision/bsi-binary';
import { Document } from 'mongodb';
import { UTXOsAggregationV2 } from './UTXOsAggregationV2.js';

export class BalanceOfAggregationV2 extends UTXOsAggregationV2 {
    public getAggregation(wallet: Address, filterOrdinals: boolean = true): Document[] {
        const aggregation: Document[] = super.getAggregation(wallet, false, filterOrdinals);

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
