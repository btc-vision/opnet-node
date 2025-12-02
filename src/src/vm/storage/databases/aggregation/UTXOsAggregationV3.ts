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

        const aggregation: Document[] = [
            {
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
            },
            {
                $sort: {
                    value: -1,
                },
            },
        ];

        if (limit) {
            aggregation.push({
                $limit: Config.API.UTXO_LIMIT,
            });
        }

        if (pushRawTxs) {
            aggregation.push({
                $lookup: {
                    from: 'Transactions',
                    localField: 'transactionId',
                    foreignField: 'id',
                    as: 'transactionData',
                },
            });

            aggregation.push({
                $unwind: {
                    path: '$transactionData',
                    preserveNullAndEmptyArrays: true,
                },
            });

            aggregation.push({
                $facet: {
                    results: [
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
                    ],
                },
            });

            aggregation.push({
                $project: {
                    utxos: {
                        $ifNull: [{ $arrayElemAt: ['$results.utxos', 0] }, []],
                    },
                },
            });

            aggregation.push({
                $project: {
                    utxos: 1,
                    deduped: {
                        $reduce: {
                            input: '$utxos',
                            initialValue: { ids: [], arr: [] },
                            in: {
                                ids: {
                                    $cond: [
                                        { $in: ['$$this.transactionId', '$$value.ids'] },
                                        '$$value.ids',
                                        {
                                            $concatArrays: [
                                                '$$value.ids',
                                                ['$$this.transactionId'],
                                            ],
                                        },
                                    ],
                                },
                                arr: {
                                    $cond: [
                                        { $in: ['$$this.transactionId', '$$value.ids'] },
                                        '$$value.arr',
                                        { $concatArrays: ['$$value.arr', ['$$this.raw']] },
                                    ],
                                },
                            },
                        },
                    },
                },
            });

            aggregation.push({
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
                                raw: { $indexOfArray: ['$deduped.ids', '$$utxo.transactionId'] },
                            },
                        },
                    },
                    raw: '$deduped.arr',
                },
            });
        } else {
            aggregation.push({
                $facet: {
                    results: [
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
                    ],
                },
            });

            aggregation.push({
                $project: {
                    _id: 0,
                    utxos: {
                        $ifNull: [{ $arrayElemAt: ['$results.utxos', 0] }, []],
                    },
                    raw: { $literal: [] },
                },
            });
        }

        console.log(`aggregation`, JSON.stringify(aggregation, null, 4));

        return aggregation;
    }

    // This version is faster but fail when the array is empty.
    /*public getAggregation(
        wallet: string,
        limit: boolean = true,
        optimize: boolean = false,
        pushRawTxs: boolean = true,
        olderThan: bigint | undefined,
    ): Document[] {
        const minValue: number = optimize ? 12000 : 330;

        const aggregation: Document[] = [
            {
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
            },
            {
                $sort: {
                    value: -1,
                },
            },
        ];

        if (limit) {
            aggregation.push({
                $limit: Config.API.UTXO_LIMIT,
            });
        }

        if (pushRawTxs) {
            aggregation.push({
                $lookup: {
                    from: 'Transactions',
                    localField: 'transactionId',
                    foreignField: 'id',
                    as: 'transactionData',
                },
            });

            aggregation.push({
                $unwind: {
                    path: '$transactionData',
                    preserveNullAndEmptyArrays: true,
                },
            });

            aggregation.push({
                $facet: {
                    results: [
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
                    ],
                },
            });

            aggregation.push({
                $project: {
                    utxos: {
                        $ifNull: [{ $arrayElemAt: ['$results.utxos', 0] }, []],
                    },
                },
            });

            aggregation.push({
                $project: {
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
            });

            aggregation.push({
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
            });
        } else {
            aggregation.push({
                $facet: {
                    results: [
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
                    ],
                },
            });

            aggregation.push({
                $project: {
                    _id: 0,
                    utxos: {
                        $ifNull: [{ $arrayElemAt: ['$results.utxos', 0] }, []],
                    },
                    raw: { $literal: [] },
                },
            });
        }

        console.log(`aggregation`, JSON.stringify(aggregation, null, 4));

        return aggregation;
    }*/
}
