import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class TransactionGroupBuilder {
    public buildGroups(
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

    private findDependencies(
        transactions: Transaction<OPNetTransactionTypes>[],
        txid: string,
    ): Transaction<OPNetTransactionTypes>[] {
        return transactions.filter((tx) =>
            tx.inputs.some((input) => input.originalTransactionId === txid),
        );
    }
}
