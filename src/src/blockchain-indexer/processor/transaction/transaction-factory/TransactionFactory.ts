import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOpNetTransactions, TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public parseTransaction(
        data: TransactionData,
        blockHash: string,
    ): Transaction<OPNetTransactionTypes> {
        const parser: TransactionInformation = this.getTransactionType(data);
        const transactionObj = PossibleOpNetTransactions[parser.type];
        
        return transactionObj.parse(data, parser.vInIndex, blockHash);
    }

    protected getTransactionType(data: TransactionData): TransactionInformation {
        for (let _transactionType in PossibleOpNetTransactions) {
            const transactionType = _transactionType as unknown as OPNetTransactionTypes;

            // We filter out the generic transaction type
            if (transactionType === this.genericTransactionType) {
                continue;
            }

            const transactionObj = PossibleOpNetTransactions[transactionType];
            const isTransactionOfType = transactionObj.isTransaction(data);
            if (!isTransactionOfType) {
                continue;
            }

            if (isTransactionOfType) {
                return isTransactionOfType;
            }
        }

        /** Fallback to generic transaction */
        return {
            type: this.genericTransactionType,
            vInIndex: 0,
        };
    }
}
