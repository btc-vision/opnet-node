import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class GenericTransaction extends Transaction<OPNetTransactionTypes.Generic> {
    public readonly transactionType: OPNetTransactionTypes.Generic = GenericTransaction.getType();

    constructor(rawTransactionData: TransactionData, vIndexIn: number, blockHash: string) {
        super(rawTransactionData, vIndexIn, blockHash);
    }

    public static is(data: TransactionData): TransactionInformation | undefined {
        return {
            type: this.getType(),
            vInIndex: 0,
        };
    }

    private static getType(): OPNetTransactionTypes.Generic {
        return OPNetTransactionTypes.Generic;
    }
}
