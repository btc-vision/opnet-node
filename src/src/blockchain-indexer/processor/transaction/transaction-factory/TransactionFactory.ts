import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOpNetTransactions } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public parseTransaction(
        data: TransactionData,
        blockHash: string,
    ): Transaction<OPNetTransactionTypes> {
        const parser: OPNetTransactionTypes = this.getTransactionType(data);
        const transactionObj = PossibleOpNetTransactions[parser];

        return transactionObj.parse(data, blockHash);
    }

    protected getTransactionType(data: TransactionData): OPNetTransactionTypes {
        for (let _transactionType in PossibleOpNetTransactions) {
            const transactionType = _transactionType as unknown as OPNetTransactionTypes;

            // We filter out the generic transaction type
            if (transactionType === this.genericTransactionType) {
                continue;
            }

            const transactionObj = PossibleOpNetTransactions[transactionType];

            const isTransactionOfType = transactionObj.isTransaction(data);
            if (transactionType !== transactionType) {
                throw new Error(`Failed to verify that transaction has a valid type`);
            }

            if (isTransactionOfType) {
                return isTransactionOfType;
            }
        }

        /** Fallback to generic transaction */
        return this.genericTransactionType;
    }
}
