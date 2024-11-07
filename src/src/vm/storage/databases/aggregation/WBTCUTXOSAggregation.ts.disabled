import { Document } from 'mongodb';
import { Aggregation } from './Aggregation.js';

export class WBTCUTXOAggregation extends Aggregation {
    public getAggregation(): Document[] {
        return [
            {
                $match: {
                    spent: false,
                },
            },
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
            // Step 2: Union with PENDING_WBTC_UTXO collection
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
                        {
                            $match: {
                                used: {
                                    $eq: [],
                                },
                            },
                        },
                    ],
                },
            },
            // Step 4: Sort by vault minimum value and UTXO value descending
            {
                $sort: {
                    value: 1,
                },
            },
            {
                $limit: 500,
            },
            /*
            {
                $addFields: {
                    random: {
                        $rand: {},
                    },
                },
            },
            // Step 7: Sort by random value to introduce randomness
            {
                $sort: {
                    random: 1,
                },
            },*/
        ];
    }
}
