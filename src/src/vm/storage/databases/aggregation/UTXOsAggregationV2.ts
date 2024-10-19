import { Address } from '@btc-vision/transaction';
import { Decimal128, Document, Long } from 'mongodb';
import { Aggregation } from './Aggregation.js';
import { ShortScriptPubKey } from '../../../../db/interfaces/IUnspentTransaction.js';
import { Config } from '../../../../config/Config.js';

export interface UTXOSOutputTransactionFromDBV2 {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: Decimal128;
    readonly scriptPubKey: ShortScriptPubKey;
}

export class UTXOsAggregationV2 extends Aggregation {
    public getAggregation(
        wallet: Address,
        limit: boolean = true,
        optimize: boolean = false,
    ): Document[] {
        const minValue: number = optimize ? 20000 : 330;

        const aggregation: Document[] = [
            {
                $match: {
                    'scriptPubKey.address': wallet,
                    value: {
                        $gte: Long.fromValue(minValue),
                    },
                    deletedAtBlock: null,
                },
            },
        ];

        if (limit) {
            aggregation.push({
                $limit: Config.API.UTXO_LIMIT,
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
