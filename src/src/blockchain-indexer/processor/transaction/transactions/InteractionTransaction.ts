import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class InteractionTransaction extends Transaction<OPNetTransactionTypes.Interaction> {
    public readonly transactionType: OPNetTransactionTypes.Interaction =
        InteractionTransaction.getType();

    constructor(rawTransactionData: TransactionData, blockHash: string) {
        super(rawTransactionData, blockHash);
    }

    public static is(data: TransactionData): OPNetTransactionTypes.Interaction | undefined {
        return undefined;
    }

    private static getType(): OPNetTransactionTypes.Interaction {
        return OPNetTransactionTypes.Interaction;
    }
}
