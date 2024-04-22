import { BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class InteractionTransaction extends Transaction<OPNetTransactionTypes.Interaction> {
    public readonly transactionType: OPNetTransactionTypes.Interaction =
        OPNetTransactionTypes.Interaction;

    constructor(rawTransactionData: BlockDataWithTransactionData) {
        super(rawTransactionData);
    }

    public static is(data: BlockDataWithTransactionData): OPNetTransactionTypes {
        return OPNetTransactionTypes.Interaction;
    }
}
