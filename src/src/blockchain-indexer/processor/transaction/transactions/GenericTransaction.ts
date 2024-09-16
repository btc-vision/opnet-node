import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import bitcoin from 'bitcoinjs-lib';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class GenericTransaction extends Transaction<OPNetTransactionTypes.Generic> {
    public readonly transactionType: OPNetTransactionTypes.Generic = GenericTransaction.getType();

    public constructor(
        rawTransactionData: TransactionData,
        vIndexIn: number,
        blockHash: string,
        blockHeight: bigint,
        network: bitcoin.networks.Network,
    ) {
        super(rawTransactionData, vIndexIn, blockHash, blockHeight, network);
    }

    public static is(_data: TransactionData): TransactionInformation | undefined {
        return {
            type: this.getType(),
            vInIndex: 0,
        };
    }

    private static getType(): OPNetTransactionTypes.Generic {
        return OPNetTransactionTypes.Generic;
    }
}
