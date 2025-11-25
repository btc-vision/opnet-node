import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class TransactionGroupBuilder {
    public buildGroups(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[][] {
        // Build an undirected graph of all tx relationships so any connected component becomes a group
        const { transactionsById, adjacency } = this.buildAdjacency(transactions);
        const groups: Transaction<OPNetTransactionTypes>[][] = [];
        const visited = new Set<string>();

        transactions.forEach((tx) => {
            if (visited.has(tx.transactionIdString)) return;

            groups.push(
                this.collectGroup(tx.transactionIdString, transactionsById, adjacency, visited),
            );
        });

        return groups;
    }

    private buildAdjacency(transactions: Transaction<OPNetTransactionTypes>[]): {
        transactionsById: Map<string, Transaction<OPNetTransactionTypes>>;
        adjacency: Map<string, Set<string>>;
    } {
        const transactionsById = new Map(transactions.map((tx) => [tx.transactionIdString, tx]));

        const adjacency = new Map<string, Set<string>>();
        transactions.forEach((tx) => adjacency.set(tx.transactionIdString, new Set<string>()));

        transactions.forEach((tx) => {
            const txId = tx.transactionIdString;

            tx.inputs.forEach((input) => {
                if (!input.originalTransactionId || input.originalTransactionId.length === 0)
                    return;

                const parentId = input.originalTransactionId.toString('hex');
                if (transactionsById.has(parentId)) {
                    // Link both ways: a dependency chains groups together regardless of traversal direction
                    adjacency.get(txId)?.add(parentId);
                    adjacency.get(parentId)?.add(txId);
                }
            });
        });

        return { transactionsById, adjacency };
    }

    private collectGroup(
        startId: string,
        transactionsById: Map<string, Transaction<OPNetTransactionTypes>>,
        adjacency: Map<string, Set<string>>,
        visited: Set<string>,
    ): Transaction<OPNetTransactionTypes>[] {
        const group: Transaction<OPNetTransactionTypes>[] = [];
        const stack: string[] = [startId];

        while (stack.length > 0) {
            const currentId = stack.pop();
            if (!currentId || visited.has(currentId)) continue;

            visited.add(currentId);
            const currentTx = transactionsById.get(currentId);
            if (!currentTx) continue;

            group.push(currentTx);
            const neighbors = adjacency.get(currentId);
            // Walk all neighbors (parents or children) to keep the component intact
            neighbors?.forEach((neighborId) => {
                if (!visited.has(neighborId)) {
                    stack.push(neighborId);
                }
            });
        }

        return group;
    }
}
