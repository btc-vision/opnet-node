import { Address } from '@btc-vision/bsi-binary';
import { Decimal128, Document } from 'mongodb';
import { UTXOSAggregation } from './UTXOSAggregation.js';

export interface BalanceOfOutputTransactionFromDB {
    readonly balance: Decimal128;
}

export class BalanceOfAggregation extends UTXOSAggregation {
    constructor() {
        super();
    }

    public getAggregation(wallet: Address): Document[] {
        const aggregation: Document[] = super.getAggregation(wallet);

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
