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

        // Filter block rewards and non-block rewards
        const blockRewards = transactions.filter((t) =>
            t.inputs.some((input) => input.originalTransactionId === undefined),
        );

        const nonBlockRewards = transactions.filter((t) =>
            t.inputs.every((input) => input.originalTransactionId !== undefined),
        );

        // Initialize the final list with block rewards since they have no dependencies
        let finalList: Transaction<OPNetTransactionTypes>[] = [...blockRewards];

        // Build dependency groups for non-block rewards
        const groups: Transaction<OPNetTransactionTypes>[][] = this.buildGroups(nonBlockRewards);

        // Sort groups by total burned fee and flatten into the final list
        const sortedGroups = this.sortGroupsByBurnedFees(groups);
        for (let i = 0; i < sortedGroups.length; i++) {
            const group = sortedGroups[i];
            //const totalGroupBurnedFee = this.calculateTotalBurnedFees(group);

            //console.log(`Group ${i} has total burned fee: ${totalGroupBurnedFee}`);
            this.sortTransactionsWithinGroup(group, finalList);
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

    private buildGroups(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[][] {
        const groups: Transaction<OPNetTransactionTypes>[][] = [];
        const visited = new Set<string>();

        transactions.forEach((tx) => {
            if (!visited.has(tx.transactionId)) {
                const group: Transaction<OPNetTransactionTypes>[] = [];
                this.collectGroup(tx, transactions, group, visited);
                groups.push(group);
            }
        });

        return groups;
    }

    private collectGroup(
        tx: Transaction<OPNetTransactionTypes>,
        allTransactions: Transaction<OPNetTransactionTypes>[],
        group: Transaction<OPNetTransactionTypes>[],
        visited: Set<string>,
    ): void {
        if (visited.has(tx.transactionId)) return;

        visited.add(tx.transactionId);
        group.push(tx);
        const dependencies = this.findDependencies(allTransactions, tx.transactionId);
        dependencies.forEach((dep) => this.collectGroup(dep, allTransactions, group, visited));
    }

    private sortTransactionsWithinGroup(
        group: Transaction<OPNetTransactionTypes>[],
        finalList: Transaction<OPNetTransactionTypes>[],
    ): void {
        group.forEach((tx) => {
            if (!finalList.includes(tx)) {
                finalList.push(tx);
            }
        });
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

    private calculateTotalBurnedFees(group: Transaction<OPNetTransactionTypes>[]): bigint {
        return group.reduce((acc, tx) => acc + tx.burnedFee, 0n);
    }

    private compareHashLists(
        a: Transaction<OPNetTransactionTypes>[],
        b: Transaction<OPNetTransactionTypes>[],
    ): number {
        const concatHashA = this.concatenateHashes(a);
        const concatHashB = this.concatenateHashes(b);
        return Buffer.compare(concatHashA, concatHashB);
    }

    private concatenateHashes(group: Transaction<OPNetTransactionTypes>[]): Buffer {
        return Buffer.concat(group.map((tx) => tx.computedIndexingHash));
    }
}
