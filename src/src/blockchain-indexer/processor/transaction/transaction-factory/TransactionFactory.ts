import { BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOpNetTransactions } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class TransactionFactory {
    public parseTransaction(
        data: BlockDataWithTransactionData,
    ): Transaction<OPNetTransactionTypes> | undefined {
        const parser: OPNetTransactionTypes | undefined = this.getTransactionType(data);

        if (!parser) {
            return;
        }

        const transactionObj = PossibleOpNetTransactions[parser];
        if (!transactionObj) {
            return;
        }

        return transactionObj.parse(data);
    }

    protected getTransactionType(
        data: BlockDataWithTransactionData,
    ): OPNetTransactionTypes | undefined {
        for (let _transactionType in PossibleOpNetTransactions) {
            const transactionObj =
                PossibleOpNetTransactions[_transactionType as unknown as OPNetTransactionTypes];

            const isTransactionOfType = transactionObj.isTransaction(data);
            if (isTransactionOfType) {
                return isTransactionOfType;
            }
        }
    }
}
