import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';
import { TransactionGroupBuilder } from './TransactionGroupBuilder.js';
import { TransactionGroupFeesSorter } from './TransactionGroupFeesSorter.js';

/**
 * The goal of this class is to sort transactions in bitcoin blocks where their position in a block is topologically sorted.
 * We have to sort transactions in a block to ensure that the transactions are processed in the correct order.
 *
 * The chosen strategy if to sort transaction by their fee and priority fee.
 * Transaction with the same fee will get stored via a tie-breaking hash.
 */
export class TransactionSorter {
    public sortTransactions(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        const feesSorter: TransactionGroupFeesSorter = new TransactionGroupFeesSorter();
        const groupBuilder: TransactionGroupBuilder = new TransactionGroupBuilder();
        const initialLength = transactions.length;

        // Filter block rewards and non-block rewards
        const blockRewards = transactions.filter((t) =>
            t.inputs.some((input) => input.originalTransactionId.length === 0),
        );

        const nonBlockRewards = transactions.filter((t) =>
            t.inputs.every((input) => input.originalTransactionId.length !== 0),
        );

        // Initialize the final list with block rewards since they have no dependencies
        const finalList: Transaction<OPNetTransactionTypes>[] = [...blockRewards];

        // Build dependency groups for non-block rewards
        const groups: Transaction<OPNetTransactionTypes>[][] =
            groupBuilder.buildGroups(nonBlockRewards);

        // Sort groups by total burned fee and flatten into the final list
        const sortedGroups = feesSorter.sortGroupByFees(groups);
        for (let i = 0; i < sortedGroups.length; i++) {
            const group = sortedGroups[i];
            //const totalGroupBurnedFee = this.calculateTotalBurnedFees(group);

            //console.log(`Group ${i} has total burned fee: ${totalGroupBurnedFee}`);
            this.verifyDuplicatedTransactionsAndPushToFinalList(group, finalList);
        }

        // Ensure the index of each transaction in the final list
        finalList.forEach((tx, index) => {
            tx.index = index;
        });

        if (finalList.length !== initialLength) {
            throw new Error(
                `Transaction count changed during sorting. Expected ${initialLength}, got ${finalList.length}.`,
            );
        }

        return finalList;
    }

    public sortTransactionsByOrder(
        transactionIds: string[],
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        if (transactionIds.length !== transactions.length) {
            throw new Error(
                `Transaction count changed during sorting. Expected ${transactions.length}, got ${transactionIds.length}.`,
            );
        }

        const newOrder: Transaction<OPNetTransactionTypes>[] = [];

        for (let i = 0; i < transactionIds.length; i++) {
            const tx = transactions.find((t) => t.transactionIdString === transactionIds[i]);
            if (tx) {
                newOrder.push(tx);
            } else {
                throw new Error(`Transaction with id ${transactionIds[i]} not found.`);
            }
        }

        return newOrder;
    }

    // Optional to avoid duplicated transactions
    private verifyDuplicatedTransactionsAndPushToFinalList(
        group: Transaction<OPNetTransactionTypes>[],
        finalList: Transaction<OPNetTransactionTypes>[],
    ): void {
        group.forEach((tx) => {
            if (!finalList.includes(tx)) {
                finalList.push(tx);
            }
        });
    }
}
