import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class DeploymentTransaction extends Transaction<OPNetTransactionTypes.Deployment> {
    public readonly transactionType: OPNetTransactionTypes.Deployment =
        DeploymentTransaction.getType();

    constructor(rawTransactionData: TransactionData, blockHash: string) {
        super(rawTransactionData, blockHash);
    }

    public static is(data: TransactionData): OPNetTransactionTypes.Deployment | undefined {
        return undefined;
    }

    private static getType(): OPNetTransactionTypes.Deployment {
        return OPNetTransactionTypes.Deployment;
    }
}
