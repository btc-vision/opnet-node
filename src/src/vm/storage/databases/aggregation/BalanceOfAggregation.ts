import { Address } from '@btc-vision/bsi-binary';
import { Decimal128, Document } from 'mongodb';
import { UTXOsAggregation } from './UTXOsAggregation.js';

export interface BalanceOfOutputTransactionFromDB {
    readonly balance: Decimal128;
}

export class BalanceOfAggregation extends UTXOsAggregation {
    constructor() {
        super();
    }

    public getAggregation(wallet: Address): Document[] {
        const aggregation: Document[] = super.getAggregation(wallet, false);

        aggregation.push({
            $group: {
                _id: 0,
                balance: {
                    $sum: '$value',
                },
            },
        });

        return aggregation;
    }
}
