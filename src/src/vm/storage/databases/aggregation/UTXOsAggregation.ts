import { Address } from '@btc-vision/transaction';
import { Document } from 'mongodb';
import { Aggregation } from './Aggregation.js';

export class UTXOsAggregation extends Aggregation {
    public getAggregation(
        wallet: Address,
        limit: boolean = true,
        optimize: boolean = false,
    ): Document[] {
        const minValue: number = optimize ? 9999 : 330;

        const aggregation: Document[] = [
            {
                $match: {
                    'outputs.scriptPubKey.address': wallet,
                    'outputs.value': {
                        $gte: minValue,
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
                                        $gte: ['$$output.value', minValue],
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
                        transaction_id: '$id',
                    },
                    pipeline: [
                        {
                            $project: {
                                inputs: {
                                    $filter: {
                                        input: '$inputs',
                                        as: 'input',
                                        cond: {
                                            $and: [
                                                {
                                                    $eq: [
                                                        '$$input.outputTransactionIndex',
                                                        '$$output_index',
                                                    ],
                                                },
                                                {
                                                    $eq: [
                                                        '$$input.originalTransactionId',
                                                        '$$transaction_id',
                                                    ],
                                                },
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
