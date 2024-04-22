import { BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class DeploymentTransaction extends Transaction<OPNetTransactionTypes.Deployment> {
    public readonly transactionType: OPNetTransactionTypes.Deployment =
        OPNetTransactionTypes.Deployment;

    constructor(rawTransactionData: BlockDataWithTransactionData) {
        super(rawTransactionData);
    }

    public static is(data: BlockDataWithTransactionData): OPNetTransactionTypes {
        return OPNetTransactionTypes.Deployment;
    }
}
