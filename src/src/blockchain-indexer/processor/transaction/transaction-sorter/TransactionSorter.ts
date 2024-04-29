import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

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
        const initialLength = transactions.length;

        // Build dependency groups
        const blockRewards = transactions.filter((t) =>
            t.inputs.some((input) => input.originalTransactionId === undefined),
        );

        const nonBlockRewards = transactions.filter((t) =>
            t.inputs.every((input) => input.originalTransactionId !== undefined),
        );

        // Build dependency groups for non-block rewards
        const groups: Transaction<OPNetTransactionTypes>[][] = [];
        const visited = new Set<string>();

        for (const transaction of nonBlockRewards) {
            if (!visited.has(transaction.transactionId)) {
                const group = [];
                let currentTransaction = transaction;
                let dependencies = this.findDependencies(
                    nonBlockRewards,
                    currentTransaction.transactionId,
                );

                while (dependencies.length > 0) {
                    group.push(currentTransaction);
                    visited.add(currentTransaction.transactionId);
                    currentTransaction = dependencies.pop()!;
                    dependencies = this.findDependencies(
                        nonBlockRewards,
                        currentTransaction.transactionId,
                    );
                }

                group.push(currentTransaction);
                visited.add(currentTransaction.transactionId);
                groups.push(group);
            }
        }

        // Sort groups by total burned fee
        const sortedGroups = this.sortGroupsByBurnedFees(groups);
        const finalSortedGroups = sortedGroups.map((group) =>
            this.sortTransactionsWithinGroup(group),
        );

        // We set the index of each transaction in the final list
        const finalList = blockRewards.concat(finalSortedGroups.flat());
        for (let i = 0; i < finalList.length; i++) {
            finalList[i].index = i;
        }

        if (finalList.length !== initialLength) {
            throw new Error(
                `Transaction count changed during sorting. This should never happen. Transaction count was ${initialLength} before sorting and ${finalList.length} after sorting.`,
            );
        }

        return finalList;
    }

    private sortTransactionsWithinGroup(
        group: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        const txMap = new Map<string, Transaction<OPNetTransactionTypes>>();

        // Map each transaction by its ID for quick access
        group.forEach((tx) => txMap.set(tx.transactionId, tx));

        const sortedTransactions: Transaction<OPNetTransactionTypes>[] = [];
        const visited = new Set<string>();

        // Ensure all transactions maintain the correct order based on dependencies
        group.forEach((tx) => {
            if (!visited.has(tx.transactionId)) {
                this.resolveDependencies(tx, txMap, sortedTransactions, visited);
            }
        });

        return sortedTransactions;
    }

    private resolveDependencies(
        tx: Transaction<OPNetTransactionTypes>,
        txMap: Map<string, Transaction<OPNetTransactionTypes>>,
        sortedTransactions: Transaction<OPNetTransactionTypes>[],
        visited: Set<string>,
    ): void {
        visited.add(tx.transactionId);

        // Recursively resolve dependencies for each input
        tx.inputs.forEach((input) => {
            if (input.originalTransactionId === undefined) return;

            const hasMap = txMap.get(input.originalTransactionId);
            if (hasMap && !visited.has(input.originalTransactionId)) {
                this.resolveDependencies(hasMap, txMap, sortedTransactions, visited);
            }
        });

        // Add the transaction to the sorted list
        sortedTransactions.push(tx);
    }

    private concatenateHashes(group: Transaction<OPNetTransactionTypes>[]): Buffer {
        // Concatenate all computedIndexingHash buffers of a group into a single buffer
        return Buffer.concat(group.map((tx) => tx.computedIndexingHash));
    }

    private compareHashLists(
        a: Transaction<OPNetTransactionTypes>[],
        b: Transaction<OPNetTransactionTypes>[],
    ): number {
        // Concatenate hashes for both groups
        const concatHashA = this.concatenateHashes(a);
        const concatHashB = this.concatenateHashes(b);

        // Compare the concatenated hashes
        return Buffer.compare(concatHashA, concatHashB);
    }

    private calculateTotalBurnedFees(group: Transaction<OPNetTransactionTypes>[]): bigint {
        return group.reduce((acc, transaction) => acc + transaction.burnedFee, 0n);
    }

    private findDependencies(
        transactions: Transaction<OPNetTransactionTypes>[],
        txid: string,
    ): Transaction<OPNetTransactionTypes>[] {
        return transactions.filter((tx) =>
            tx.inputs.some((input) => input.originalTransactionId === txid),
        );
    }

    private sortGroupsByBurnedFees(
        groups: Transaction<OPNetTransactionTypes>[][],
    ): Transaction<OPNetTransactionTypes>[][] {
        return groups.sort((a, b) => {
            const totalA = this.calculateTotalBurnedFees(a);
            const totalB = this.calculateTotalBurnedFees(b);
            if (totalA < totalB) {
                return 1; // For descending order, return 1 if A is less than B
            } else if (totalA > totalB) {
                return -1; // For descending order, return -1 if A is greater than B
            } else {
                return this.compareHashLists(a, b);
            }
        });
    }
}
