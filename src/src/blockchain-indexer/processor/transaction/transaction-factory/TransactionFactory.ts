import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import bitcoin from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOpNetTransactions, TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public parseTransaction(
        data: TransactionData,
        blockHash: string,
        blockHeight: bigint,
        network: bitcoin.networks.Network,
    ): Transaction<OPNetTransactionTypes> {
        const parser: TransactionInformation = this.getTransactionType(data);
        const transactionObj = PossibleOpNetTransactions[parser.type];

        const tx = transactionObj.parse(data, parser.vInIndex, blockHash, blockHeight, network);
        tx.parseTransaction(data.vin, data.vout);

        return tx;
    }

    protected getTransactionType(data: TransactionData): TransactionInformation {
        for (const _transactionType in PossibleOpNetTransactions) {
            const transactionType = _transactionType as OPNetTransactionTypes;

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
