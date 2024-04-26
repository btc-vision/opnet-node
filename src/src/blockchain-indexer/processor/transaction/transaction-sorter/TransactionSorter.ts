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
    constructor() {}

    public sortTransactions(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        // Separate block rewards
        const blockRewards = transactions.filter((t) =>
            t.inputs.some((input) => input.originalTransactionId === undefined),
        );
        const nonBlockRewards = transactions.filter((t) =>
            t.inputs.every((input) => input.originalTransactionId !== undefined),
        );

        // Sort block rewards by burned fee
        const sortedBlockRewards = blockRewards.sort((a, b) => Number(a.burnedFee - b.burnedFee));

        // Dependency graph for transactions
        const graph: Map<string, Transaction<OPNetTransactionTypes>[]> = new Map();
        transactions.forEach((tx) => {
            tx.inputs.forEach((input) => {
                if (input.originalTransactionId) {
                    if (!graph.has(input.originalTransactionId)) {
                        graph.set(input.originalTransactionId, []);
                    }
                    graph.get(input.originalTransactionId)!.push(tx);
                }
            });
        });

        // Topological sort respecting transaction dependencies
        const sortedTransactions = this.topologicalSort(nonBlockRewards, graph);

        const result = sortedBlockRewards.concat(sortedTransactions);
        for(let i = 0; i < result.length; i++) {
            result[i].index = i;
        }

        return result;
    }

    private isRBF(transaction: Transaction<OPNetTransactionTypes>): boolean {
        return transaction.inputs.some((input) => input.sequenceId < 0xfffffffe);
    }

    private topologicalSort(
        transactions: Transaction<OPNetTransactionTypes>[],
        graph: Map<string, Transaction<OPNetTransactionTypes>[]>,
    ): Transaction<OPNetTransactionTypes>[] {
        const sorted: Transaction<OPNetTransactionTypes>[] = [];
        const visited: Set<string> = new Set();

        const visit = (tx: Transaction<OPNetTransactionTypes>) => {
            const txId = tx.transactionId;
            if (visited.has(txId)) return;
            visited.add(txId);

            const dependents = graph.get(txId);
            if (dependents) {
                dependents.forEach((dependentTx) => visit(dependentTx));
            }

            sorted.push(tx);
        };

        transactions = transactions.sort((a, b) => {
            const feeDiff = Number(b.burnedFee - a.burnedFee);
            if (feeDiff !== 0) return feeDiff;

            // TODO: Verify that we need to handle RBF transactions
            /*if (this.isRBF(a) && !this.isRBF(b)) {
                return -1;
            } else if (!this.isRBF(a) && this.isRBF(b)) {
                return 1;
            }*/

            // Resolve ties using the hash of (transactionHash + blockHash)
            return Buffer.compare(a.computedIndexingHash, b.computedIndexingHash);
        });

        transactions.forEach((tx) => visit(tx));

        return sorted.reverse();
    }
}
