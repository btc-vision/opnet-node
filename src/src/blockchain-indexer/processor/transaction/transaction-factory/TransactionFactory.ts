import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { networks } from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOPNetTransactions, TransactionInformation } from '../PossibleOPNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public parseTransaction(
        data: TransactionData,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        allowedPreimages: Buffer[] = [],
    ): Transaction<OPNetTransactionTypes> {
        if (!Array.isArray(allowedPreimages)) {
            throw new Error('Allowed preimages must be an array');
        }

        const parser: TransactionInformation = this.getTransactionType(data);
        const transactionObj = PossibleOPNetTransactions[parser.type];

        const tx = transactionObj.parse(data, parser.vInIndex, blockHash, blockHeight, network);
        tx.verifyPreImage = (preimage: Buffer) => {
            const isValid = allowedPreimages.some((allowedPreimage) =>
                allowedPreimage.equals(preimage),
            );

            if (!isValid) {
                throw new Error('Invalid preimage');
            }
        };

        tx.parseTransaction(data.vin, data.vout);

        return tx;
    }

    protected getTransactionType(data: TransactionData): TransactionInformation {
        for (const _transactionType in PossibleOPNetTransactions) {
            const transactionType = _transactionType as OPNetTransactionTypes;

            // We filter out the generic transaction type
            if (transactionType === this.genericTransactionType) {
                continue;
            }

            const transactionObj = PossibleOPNetTransactions[transactionType];
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
