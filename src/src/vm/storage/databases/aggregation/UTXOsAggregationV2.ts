import { Binary, Decimal128, Document, Long } from 'mongodb';
import { Aggregation } from './Aggregation.js';
import { ShortScriptPubKey } from '../../../../db/interfaces/IUnspentTransaction.js';
import { Config } from '../../../../config/Config.js';
import { DataConverter } from '@btc-vision/bsi-common';

export interface UTXOSOutputTransactionFromDBV2 {
    readonly transactionId: Binary;
    readonly outputIndex: number;
    readonly value: Decimal128;
    readonly scriptPubKey: ShortScriptPubKey;
    readonly raw?: Binary;
}

export class UTXOsAggregationV2 extends Aggregation {
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

        const projected: {
            [key: string]: number | string | { $literal: string } | { $transactionData: string };
        } = {
            _id: 0,
            transactionId: 1,
            outputIndex: 1,
            value: 1,
            scriptPubKey: 1,
        };

        if (pushRawTxs) {
            aggregation.push({
                $lookup: {
                    from: 'Transactions', // Collection name
                    localField: 'transactionId', // Field in UnspentTransactions
                    foreignField: 'id', // Field in Transactions
                    as: 'transactionData',
                },
            });

            aggregation.push({
                $unwind: {
                    path: '$transactionData',
                    preserveNullAndEmptyArrays: true, // In case there's no matching doc
                },
            });

            projected.raw = '$transactionData.raw';
        }

        aggregation.push({
            $project: projected,
        });

        return aggregation;
    }
}
