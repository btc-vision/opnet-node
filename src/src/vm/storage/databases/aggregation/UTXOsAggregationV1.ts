import { Address } from '@btc-vision/bsi-binary';
import { Document } from 'mongodb';
import { Aggregation } from './Aggregation.js';

export class UTXOsAggregationV1 extends Aggregation {
    constructor() {
        super();
    }

    public getAggregation(wallet: Address): Document[] {
        return [
            {
                $match: {
                    /*$or: [
                    {
                        'outputs.scriptPubKey.address': wallet,
                    },
                    {
                        'outputs.scriptPubKey.addresses': wallet,
                    },
                  ],*/

                    'outputs.scriptPubKey.address': wallet,
                    'outputs.value': {
                        $gte: 330,
                    },
                },
            },
            {
                $unwind: '$outputs',
            },
            {
                $match: {
                    /*$or: [
                    {
                      "outputs.scriptPubKey.address":
                        "bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn",
                    },
                    {
                      "outputs.scriptPubKey.addresses":
                        "bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn",
                    },
                  ],*/
                    'outputs.scriptPubKey.address': wallet,
                    'outputs.value': {
                        $gte: 330,
                    },
                },
            },
            {
                $lookup: {
                    from: 'Transactions',
                    localField: 'id',
                    foreignField: 'inputs.originalTransactionId',
                    as: 'relatedInputs',
                    let: {
                        output_index: '$outputs.index',
                    },
                    pipeline: [
                        {
                            $unwind: '$inputs',
                        },
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$inputs.outputTransactionIndex', '$$output_index'],
                                },
                            },
                        },
                    ],
                },
            },
            {
                $match: {
                    relatedInputs: {
                        $size: 0,
                    },
                    /*$or: [
                    {
                      "outputs.scriptPubKey.address":
                        "bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn",
                    },
                    {
                      "outputs.scriptPubKey.addresses":
                        "bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn",
                    },
                  ],*/
                    'outputs.scriptPubKey.address': wallet,
                },
            },
            {
                $project: {
                    _id: 0,
                    transactionId: '$id',
                    outputIndex: '$outputs.index',
                    value: '$outputs.value',
                    scriptPubKey: '$outputs.scriptPubKey',
                },
            },
        ]; /*[
            {
                $match: {
                    'outputs.scriptPubKey.address': wallet,
                    'outputs.value': { $gte: 330 },
                },
            },
            {
                $unwind: '$outputs',
            },
            {
                $match: {
                    $or: [
                        {
                            'outputs.scriptPubKey.address': wallet,
                        },
                        {
                            'outputs.scriptPubKey.addresses': wallet,
                        },
                    ],
                    'outputs.value': { $gte: 330 },
                },
            },
            {
                $lookup: {
                    from: 'Transactions',
                    localField: 'id',
                    foreignField: 'inputs.originalTransactionId',
                    as: 'relatedInputs',
                    let: {
                        output_index: '$outputs.index',
                    },
                    pipeline: [
                        {
                            $unwind: '$inputs',
                        },
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$inputs.outputTransactionIndex', '$$output_index'],
                                },
                            },
                        },
                    ],
                },
            },
            {
                $match: {
                    relatedInputs: {
                        $size: 0,
                    },
                    $or: [
                        {
                            'outputs.scriptPubKey.address': wallet,
                        },
                        {
                            'outputs.scriptPubKey.addresses': wallet,
                        },
                    ],
                },
            },
            {
                $project: {
                    _id: 0,
                    transactionId: '$id',
                    outputIndex: '$outputs.index',
                    value: '$outputs.value',
                    scriptPubKey: '$outputs.scriptPubKey',
                },
            },
        ];*/
    }
}
