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

export class UTXOsAggregation extends Aggregation {
    constructor() {
        super();
    }

    public getAggregation(wallet: Address, limit: boolean = true): Document[] {
        const aggregation: Document[] = [
            {
                $match: {
                    'outputs.scriptPubKey.address': wallet,
                    'outputs.value': {
                        $gte: 330,
                    },
                },
            },
            {
                $addFields: {
                    filteredOutputs: {
                        $filter: {
                            input: '$outputs',
                            as: 'output',
                            cond: {
                                $and: [
                                    {
                                        $eq: ['$$output.scriptPubKey.address', wallet],
                                    },
                                    {
                                        $gte: ['$$output.value', 330],
                                    },
                                ],
                            },
                        },
                    },
                },
            },
            {
                $match: {
                    'filteredOutputs.0': {
                        $exists: true,
                    },
                },
            },
            {
                $unwind: '$filteredOutputs',
            },
            {
                $lookup: {
                    from: 'Transactions',
                    localField: 'id',
                    foreignField: 'inputs.originalTransactionId',
                    as: 'relatedInputs',
                    let: {
                        output_index: '$filteredOutputs.index',
                    },
                    pipeline: [
                        {
                            $project: {
                                inputs: {
                                    $filter: {
                                        input: '$inputs',
                                        as: 'input',
                                        cond: {
                                            $eq: [
                                                '$$input.outputTransactionIndex',
                                                '$$output_index',
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                        {
                            $match: {
                                inputs: {
                                    $ne: [],
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
                    'filteredOutputs.scriptPubKey.address': wallet,
                },
            },
        ];

        if (limit) {
            aggregation.push({
                $limit: 200,
            });
        }

        aggregation.push({
            $project: {
                _id: 0,
                transactionId: '$id',
                outputIndex: '$filteredOutputs.index',
                value: '$filteredOutputs.value',
                scriptPubKey: '$filteredOutputs.scriptPubKey',
                relatedInputsSize: 1,
            },
        });

        return aggregation;
    }
}
