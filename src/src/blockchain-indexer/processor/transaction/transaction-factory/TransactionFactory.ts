import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { networks } from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOPNetTransactions, TransactionInformation } from '../PossibleOPNetTransactions.js';
import { Transaction } from '../Transaction.js';
import { AddressCache } from '../../AddressCache.js';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public parseTransaction(
        data: TransactionData,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        allowedPreimages: Buffer[],
        addressCache?: AddressCache,
    ): Transaction<OPNetTransactionTypes> {
        if (!Array.isArray(allowedPreimages)) {
            throw new Error('Allowed preimages must be an array');
        }

        const parser: TransactionInformation = this.getTransactionType(data);
        const transactionObj = PossibleOPNetTransactions[parser.type];
        const index = parser.vInIndex;

        const tx = transactionObj.parse(data, index, blockHash, blockHeight, network, addressCache);
        tx.verifyPreImage = (_preimage: Buffer) => {
            /*const isValid = allowedPreimages.some((allowedPreimage) =>
                allowedPreimage.equals(preimage),
            );

            if (!isValid) {
                throw new Error(
                    'Transaction was pending in the mempool for too long. It is no longer valid.',
                );
            }*/
        };

        /*if (processTask && tx.transactionType === OPNetTransactionTypes.Interaction) {
            const a = await processTask({
                data,
                vIndexIn: index,
                blockHash,
                blockHeight,
                allowedPreimages: allowedPreimages.map((p) => p.toString('hex')),
            });

            tx.restoreFromDocument(a, data);

            return tx;
        } else {*/
        tx.parseTransaction(data.vin, data.vout);

        return tx;
        //}
    }

    protected getTransactionType(data: TransactionData): TransactionInformation {
        // We treat all transactions version 1 as generic transactions by default.
        if (data.version !== 2) {
            const txInfo =
                PossibleOPNetTransactions[this.genericTransactionType].isTransaction(data);

            if (txInfo) {
                return txInfo;
            } else {
                throw new Error('Invalid transaction data');
            }
        }

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
