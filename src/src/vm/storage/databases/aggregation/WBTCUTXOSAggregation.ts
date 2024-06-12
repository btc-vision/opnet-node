import { ScriptPubKey } from '@btc-vision/bsi-bitcoin-rpc';
import { Decimal128, Document } from 'mongodb';
import { Aggregation } from './Aggregation.js';

export interface WBTCUTXOAggregationResponse {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: Decimal128;
    readonly scriptPubKey: ScriptPubKey;
}

export class WBTCUTXOAggregation extends Aggregation {
    constructor() {
        super();
    }

    public getAggregation(): Document[] {
        return [
            // Step 1: Match UTXOs that are not in the USED_WBTC_UTXO collection
            {
                $lookup: {
                    from: 'USED_WBTC_UTXO',
                    let: {
                        hash: '$hash',
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$hash', '$$hash'],
                                },
                            },
                        },
                    ],
                    as: 'used',
                },
            },
            // Filter out used UTXOs
            {
                $match: {
                    used: {
                        $eq: [],
                    },
                },
            },
            {
                $unionWith: {
                    coll: 'PENDING_WBTC_UTXO',
                    pipeline: [
                        {
                            $lookup: {
                                from: 'USED_WBTC_UTXO',
                                let: {
                                    hash: '$hash',
                                },
                                pipeline: [
                                    {
                                        $match: {
                                            $expr: {
                                                $eq: ['$hash', '$$hash'],
                                            },
                                        },
                                    },
                                ],
                                as: 'used',
                            },
                        },
                    ],
                },
            },
            // Step 4: Sort by vault minimum value and UTXO value descending
            {
                $sort: {
                    'vaultDetails.minimum': 1,
                    value: -1,
                },
            },
            // Step 5: Group by vault and limit UTXOs to 500 per vault
            {
                $group: {
                    _id: '$vault',
                    utxos: {
                        $push: '$$ROOT',
                    },
                    totalValue: {
                        $sum: '$value',
                    },
                },
            },
            {
                $project: {
                    utxos: {
                        $slice: ['$utxos', 500],
                    },
                    totalValue: 1,
                },
            },
            {
                $limit: 100,
            },
        ];
    }
}
