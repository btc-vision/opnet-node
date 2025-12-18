import { Binary, Decimal128, Document, Long } from 'mongodb';
import { Aggregation } from './Aggregation.js';
import { ShortScriptPubKey } from '../../../../db/interfaces/IUnspentTransaction.js';
import { Config } from '../../../../config/Config.js';
import { DataConverter } from '@btc-vision/bsi-common';

export interface UTXOSOutputTransactionFromDBV3 {
    readonly transactionId: Binary;
    readonly outputIndex: number;
    readonly value: Decimal128;
    readonly scriptPubKey: ShortScriptPubKey;
}

export class UTXOsAggregationV3 extends Aggregation {
    public getAggregation(
        wallet: string,
        limit: boolean = true,
        optimize: boolean = false,
        olderThan: bigint | undefined,
    ): Document[] {
        const minValue: number = optimize ? 12000 : 330;

        const aggregation: Document[] = [
            {
                $match: {
                    'scriptPubKey.address': wallet,
                    value: { $gte: Long.fromValue(minValue) },
                    deletedAtBlock: null,
                    ...(olderThan !== undefined
                        ? { blockHeight: { $lte: DataConverter.toDecimal128(olderThan) } }
                        : {}),
                },
            },
            { $sort: { value: -1 } },
        ];

        if (limit) {
            aggregation.push({ $limit: Config.API.UTXO_LIMIT });
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
