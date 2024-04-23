import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class GenericTransaction extends Transaction<OPNetTransactionTypes.Generic> {
    public readonly transactionType: OPNetTransactionTypes.Generic = GenericTransaction.getType();

    constructor(rawTransactionData: TransactionData, blockHash: string) {
        super(rawTransactionData, blockHash);
    }

    public static is(_data: TransactionData): OPNetTransactionTypes.Generic {
        return GenericTransaction.getType();
    }

    private static getType(): OPNetTransactionTypes.Generic {
        return OPNetTransactionTypes.Generic;
    }
}
