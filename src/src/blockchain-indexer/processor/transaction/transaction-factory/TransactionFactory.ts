import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { networks } from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOpNetTransactions, TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public async parseTransaction(
        data: TransactionData,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        utxoResolver: (
            txid: string,
            vout: number,
        ) => Promise<{ scriptPubKeyHex: string; type: string } | undefined>,
    ): Promise<Transaction<OPNetTransactionTypes>> {
        const parser: TransactionInformation = await this.getTransactionType(data, utxoResolver);
        const transactionObj = PossibleOpNetTransactions[parser.type];

        const tx = transactionObj.parse(data, parser.vInIndex, blockHash, blockHeight, network);
        tx.parseTransaction(data.vin, data.vout);

        return tx;
    }

    protected async getTransactionType(
        data: TransactionData,
        utxoResolver: (
            txid: string,
            vout: number,
        ) => Promise<{ scriptPubKeyHex: string; type: string } | undefined>,
    ): Promise<TransactionInformation> {
        for (const _transactionType in PossibleOpNetTransactions) {
            const transactionType = _transactionType as OPNetTransactionTypes;

            // We filter out the generic transaction type
            if (transactionType === this.genericTransactionType) {
                continue;
            }

            const transactionObj = PossibleOpNetTransactions[transactionType];
            const isTransactionOfType = await transactionObj.isTransaction(data, utxoResolver);
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
