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
    readonly raw?: number;
}

export interface UTXOsAggregationResultV3 {
    readonly utxos: UTXOSOutputTransactionFromDBV3[];
    readonly raw: Binary[];
}

export class UTXOsAggregationV3 extends Aggregation {
    public getAggregation(
        wallet: string,
        limit: boolean = true,
        optimize: boolean = false,
        pushRawTxs: boolean = true,
        olderThan: bigint | undefined,
    ): Document[] {
        const minValue: number = optimize ? 12000 : 330;

        const matchStage: Document = {
            $match: {
                'scriptPubKey.address': wallet,
                value: {
                    $gte: Long.fromValue(minValue),
                },
                deletedAtBlock: null,
                ...(olderThan !== undefined
                    ? {
                          blockHeight: {
                              $lte: DataConverter.toDecimal128(olderThan),
                          },
                      }
                    : {}),
            },
        };

        const sortStage: Document = { $sort: { value: -1 } };

        const innerPipeline: Document[] = [];

        if (limit) {
            innerPipeline.push({ $limit: Config.API.UTXO_LIMIT });
        }

        if (pushRawTxs) {
            innerPipeline.push(
                {
                    $lookup: {
                        from: 'Transactions',
                        localField: 'transactionId',
                        foreignField: 'id',
                        as: 'transactionData',
                    },
                },
                {
                    $unwind: {
                        path: '$transactionData',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $group: {
                        _id: null,
                        utxos: {
                            $push: {
                                transactionId: '$transactionId',
                                outputIndex: '$outputIndex',
                                value: '$value',
                                scriptPubKey: '$scriptPubKey',
                                raw: '$transactionData.raw',
                            },
                        },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        utxos: 1,
                        raw: {
                            $reduce: {
                                input: '$utxos',
                                initialValue: { seen: {}, arr: [] },
                                in: {
                                    seen: {
                                        $cond: [
                                            {
                                                $not: [
                                                    {
                                                        $getField: {
                                                            field: {
                                                                $toString: '$$this.transactionId',
                                                            },
                                                            input: '$$value.seen',
                                                        },
                                                    },
                                                ],
                                            },
                                            {
                                                $mergeObjects: [
                                                    '$$value.seen',
                                                    {
                                                        $arrayToObject: [
                                                            [
                                                                {
                                                                    k: {
                                                                        $toString:
                                                                            '$$this.transactionId',
                                                                    },
                                                                    v: { $size: '$$value.arr' },
                                                                },
                                                            ],
                                                        ],
                                                    },
                                                ],
                                            },
                                            '$$value.seen',
                                        ],
                                    },
                                    arr: {
                                        $cond: [
                                            {
                                                $not: [
                                                    {
                                                        $getField: {
                                                            field: {
                                                                $toString: '$$this.transactionId',
                                                            },
                                                            input: '$$value.seen',
                                                        },
                                                    },
                                                ],
                                            },
                                            { $concatArrays: ['$$value.arr', ['$$this.raw']] },
                                            '$$value.arr',
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    $project: {
                        utxos: {
                            $map: {
                                input: '$utxos',
                                as: 'utxo',
                                in: {
                                    transactionId: '$$utxo.transactionId',
                                    outputIndex: '$$utxo.outputIndex',
                                    value: '$$utxo.value',
                                    scriptPubKey: '$$utxo.scriptPubKey',
                                    raw: {
                                        $getField: {
                                            field: { $toString: '$$utxo.transactionId' },
                                            input: '$raw.seen',
                                        },
                                    },
                                },
                            },
                        },
                        raw: '$raw.arr',
                    },
                },
            );
        } else {
            innerPipeline.push(
                {
                    $group: {
                        _id: null,
                        utxos: {
                            $push: {
                                transactionId: '$transactionId',
                                outputIndex: '$outputIndex',
                                value: '$value',
                                scriptPubKey: '$scriptPubKey',
                            },
                        },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        utxos: 1,
                        raw: { $literal: [] },
                    },
                },
            );
        }

        const aggregation: Document[] = [
            matchStage,
            sortStage,
            {
                $facet: {
                    results: innerPipeline,
                },
            },
            {
                $project: {
                    result: {
                        $cond: {
                            if: { $eq: [{ $size: '$results' }, 0] },
                            then: { utxos: [], raw: [] },
                            else: { $arrayElemAt: ['$results', 0] },
                        },
                    },
                },
            },
            {
                $replaceRoot: { newRoot: '$result' },
            },
        ];

        console.log(`aggregation`, JSON.stringify(aggregation, null, 4));

        return aggregation;
    }
}
