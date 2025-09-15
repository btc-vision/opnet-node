import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { networks } from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOPNetTransactions, TransactionInformation } from '../PossibleOPNetTransactions.js';
import { Transaction } from '../Transaction.js';
import { AddressCache } from '../../AddressCache.js';
import { ChallengeSolution } from '../../interfaces/TransactionPreimage.js';
import { Address } from '@btc-vision/transaction';

const EXPIRED_TRANSACTION_ERROR: string =
    'Transaction was pending in the mempool for too long. It is no longer valid.';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public parseTransaction(
        data: TransactionData,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        allowedChallenges: ChallengeSolution,
        enableVerification: boolean,
        addressCache?: AddressCache,
    ): Transaction<OPNetTransactionTypes> {
        const parser: TransactionInformation = this.getTransactionType(data);
        const transactionObj = PossibleOPNetTransactions[parser.type];
        const index = parser.vInIndex;

        const tx = transactionObj.parse(data, index, blockHash, blockHeight, network, addressCache);
        tx.verifyPreImage = (miner: Address, preimage: Buffer) => {
            if (!enableVerification) {
                return;
            }

            console.log(
                'Verifying preimage for miner',
                miner.toString(),
                'and preimage',
                preimage.toString('hex'),
                'allowedChallenges',
                allowedChallenges,
            );

            const hasMiner = allowedChallenges.get(miner);
            if (!hasMiner) {
                throw new Error(EXPIRED_TRANSACTION_ERROR);
            }

            const hasSolution = hasMiner.some((challenge) => {
                return challenge.equals(preimage);
            });

            if (!hasSolution) {
                throw new Error(EXPIRED_TRANSACTION_ERROR);
            }
        };

        /*if (processTask && tx.transactionType === OPNetTransactionTypes.Interaction) {
            const a = await processTask({
                data,
                vIndexIn: index,
                blockHash,
                blockHeight,
                allowedChallenges: allowedChallenges.map((p) => p.toString('hex')),
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
