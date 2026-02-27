import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { equals, networks, toHex } from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { PossibleOPNetTransactions, TransactionInformation } from '../PossibleOPNetTransactions.js';
import { Transaction } from '../Transaction.js';
import { AddressCache } from '../../AddressCache.js';
import { ChallengeSolution } from '../../interfaces/TransactionPreimage.js';
import { Address } from '@btc-vision/transaction';
import { OPNetConsensus } from '../../../../poc/configurations/OPNetConsensus.js';

const EXPIRED_TRANSACTION_ERROR: string =
    'Transaction was pending in the mempool for too long. It is no longer valid.';

const MINER_SOLUTION_INVALID: string =
    'The provided solution does not match any of the allowed challenges for the miner. The transaction is no longer valid.';

const INVALID_MINER_CHALLENGE_ERROR: string =
    'The provided miner address does not have a valid challenge solution.';

export class TransactionFactory {
    public readonly genericTransactionType: OPNetTransactionTypes.Generic =
        OPNetTransactionTypes.Generic;

    public parseTransaction(
        data: TransactionData,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        allowedChallenges: ChallengeSolution,
        addressCache?: AddressCache,
    ): Transaction<OPNetTransactionTypes> {
        const parser: TransactionInformation = this.getTransactionType(data);
        const transactionObj = PossibleOPNetTransactions[parser.type];
        const index = parser.vInIndex;

        const tx = transactionObj.parse(data, index, blockHash, blockHeight, network, addressCache);
        tx.verifyPreImage = (miner: Address, preimage: Uint8Array): Uint8Array | undefined => {
            //if (!enableVerification) {
            //    console.log('allowedChallenges', allowedChallenges);
            //    return;
            //}

            const hasMiner = allowedChallenges.solutions.get(miner);
            if (!hasMiner) {
                throw new Error(EXPIRED_TRANSACTION_ERROR);
            }

            const hasSolution = hasMiner.some((challenge: Uint8Array) => {
                console.log(
                    'Received',
                    preimage,
                    toHex(preimage),
                    'Comparing to',
                    challenge,
                    toHex(challenge),
                );

                return equals(challenge, preimage);
            });

            if (!hasSolution) {
                console.log(`hasMiner`, hasMiner, preimage, toHex(preimage));

                throw new Error(MINER_SOLUTION_INVALID);
            }

            if (OPNetConsensus.allowUnsafeSignatures) {
                const legacyPublicKey = allowedChallenges.legacyPublicKeys.get(miner);
                if (!legacyPublicKey) {
                    throw new Error(INVALID_MINER_CHALLENGE_ERROR);
                }

                return legacyPublicKey;
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
