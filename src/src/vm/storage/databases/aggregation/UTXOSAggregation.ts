import { Address } from '@btc-vision/bsi-binary';
import { ScriptPubKey } from '@btc-vision/bsi-bitcoin-rpc';
import { Decimal128, Document } from 'mongodb';
import { Aggregation } from './Aggregation.js';

export interface UTXOSOutputTransactionFromDB {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: Decimal128;
    readonly scriptPubKey: ScriptPubKey;
}

export class UTXOSAggregation extends Aggregation {
    constructor() {
        super();
    }

    public getAggregation(wallet: Address): Document[] {
        return [
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
        ];
    }
}
