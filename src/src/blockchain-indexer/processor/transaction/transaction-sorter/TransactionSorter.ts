import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';
import { PriorityQueue } from '@datastructures-js/priority-queue';

type DependencyGraph = {
    transactionsById: Map<string, Transaction<OPNetTransactionTypes>>;
    adjacency: Map<string, Set<string>>;
    inDegree: Map<string, number>;
};

/**
 * The goal of this class is to sort transactions in bitcoin blocks where their position in a block is topologically sorted.
 * We have to sort transactions in a block to ensure that the transactions are processed in the correct order.
 *
 * The chosen strategy is to sort transactions by their fee and priority fee.
 * Transactions with the same fee will get stored via a tie-breaking hash.
 */
export class TransactionSorter {
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

    public sortTransactions(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        const initialLength = transactions.length;

        // Keep coinbase-like rewards first, then sort all remaining txs by dependency-aware priority.
        const { blockRewards, nonBlockRewards } = this.partitionByRewardStatus(transactions);

        const sortedNonRewards = this.sortByFeeWithDependencies(nonBlockRewards);
        const finalList: Transaction<OPNetTransactionTypes>[] = [
            ...blockRewards,
            ...sortedNonRewards,
        ];

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

    /**
     * Splits reward (coinbase-like) transactions from the rest.
     */
    private partitionByRewardStatus(transactions: Transaction<OPNetTransactionTypes>[]) {
        const blockRewards = transactions.filter((t) =>
            t.inputs.some((input) => input.originalTransactionId.length === 0),
        );

        const nonBlockRewards = transactions.filter((t) =>
            t.inputs.every((input) => input.originalTransactionId.length !== 0),
        );

        return { blockRewards, nonBlockRewards };
    }

    /**
     * Sorts transactions based on their priority, but always placing parents before children.
     */
    private sortByFeeWithDependencies(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        const graph = this.buildDependencyGraph(transactions);
        const effectivePriorityCache = new Map<string, bigint>();
        const visiting = new Set<string>();

        const compareByPriority = this.createPriorityComparator(
            graph,
            effectivePriorityCache,
            visiting,
        );

        const availableTxs = new PriorityQueue<Transaction<OPNetTransactionTypes>>(
            compareByPriority,
        );
        graph.inDegree.forEach((degree, txId) => {
            if (degree === 0) {
                const tx = this.getTx(txId, graph);
                availableTxs.enqueue(tx);
            }
        });

        const resultTxs: Transaction<OPNetTransactionTypes>[] = [];
        // Classic topological traversal that always emits the most valuable available tx next.
        while (!availableTxs.isEmpty()) {
            const nextTx = <Transaction<OPNetTransactionTypes>>availableTxs.dequeue();

            resultTxs.push(nextTx);
            const children = graph.adjacency.get(nextTx.transactionIdString);
            children?.forEach((childId) => {
                const updated = (graph.inDegree.get(childId) || 0) - 1;
                graph.inDegree.set(childId, updated);
                if (updated === 0) {
                    const child = this.getTx(childId, graph);
                    availableTxs.enqueue(child);
                }
            });
        }

        if (resultTxs.length !== graph.transactionsById.size) {
            const remaining = [...graph.transactionsById.values()].filter(
                (txA) =>
                    !resultTxs.some((txB) => txA.transactionIdString === txB.transactionIdString),
            );
            // Cycles or missing parents: fall back to pure priority ordering for the leftovers.
            remaining.sort(compareByPriority);
            resultTxs.push(...remaining);
        }

        return resultTxs.filter((tx): tx is Transaction<OPNetTransactionTypes> => !!tx);
    }

    private getTx(txId: string, graph: DependencyGraph) {
        const tx = graph.transactionsById.get(txId);
        if (!tx) throw new Error(`Transaction ${txId} not found in graph.`);
        return tx;
    }

    /**
     * Build an adjacency list from parents to children and a matching in-degree map.
     */
    private buildDependencyGraph(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): DependencyGraph {
        const transactionsById = new Map(
            transactions.map((tx) => [tx.transactionIdString, tx] as const),
        );

        const adjacency = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();

        transactionsById.forEach((_tx, id) => {
            adjacency.set(id, new Set<string>());
            inDegree.set(id, 0);
        });

        transactions.forEach((tx) => {
            const childId = tx.transactionIdString;
            tx.inputs.forEach((input) => {
                const parentId = this.getInputTransactionId(input.originalTransactionId);
                if (!parentId || !transactionsById.has(parentId) || parentId === childId) {
                    return;
                }

                const children = adjacency.get(parentId);
                if (children && !children.has(childId)) {
                    children.add(childId);
                    inDegree.set(childId, (inDegree.get(childId) || 0) + 1);
                }
            });
        });

        return { transactionsById, adjacency, inDegree };
    }

    private createPriorityComparator(
        graph: DependencyGraph,
        effectivePriorityCache: Map<string, bigint>,
        visiting: Set<string>,
    ) {
        return (a: Transaction<OPNetTransactionTypes>, b: Transaction<OPNetTransactionTypes>) => {
            const effA = this.computeEffectivePriority(a, graph, effectivePriorityCache, visiting);
            const effB = this.computeEffectivePriority(b, graph, effectivePriorityCache, visiting);
            if (effA !== effB) {
                return effA > effB ? -1 : 1; // higher priority is better
            }

            const priorityA = this.getTransactionPriority(a);
            const priorityB = this.getTransactionPriority(b);
            if (priorityA !== priorityB) {
                return priorityA > priorityB ? -1 : 1;
            }

            return this.compareHashes(a, b);
        };
    }

    /**
     * Returns the best (highest) priority reachable from this transaction, so high-fee descendants
     * pull their parents earlier in the ordering.
     */
    private computeEffectivePriority(
        tx: Transaction<OPNetTransactionTypes>,
        graph: DependencyGraph,
        cache: Map<string, bigint>,
        visiting: Set<string>,
    ): bigint {
        const txId = tx.transactionIdString;

        const cachedPriority = cache.get(txId);
        if (cachedPriority != null) {
            return cachedPriority;
        }

        if (visiting.has(txId)) {
            return this.getTransactionPriority(tx);
        }

        visiting.add(txId);

        let bestPriority = this.getTransactionPriority(tx);
        const children = graph.adjacency.get(txId);
        children?.forEach((childId) => {
            const child = this.getTx(childId, graph);
            const childPriority = this.computeEffectivePriority(child, graph, cache, visiting);
            if (childPriority > bestPriority) {
                bestPriority = childPriority;
            }
        });

        visiting.delete(txId);
        cache.set(txId, bestPriority);
        return bestPriority;
    }

    private compareHashes(
        txA: Transaction<OPNetTransactionTypes>,
        txB: Transaction<OPNetTransactionTypes>,
    ): number {
        return Buffer.compare(txA.computedIndexingHash, txB.computedIndexingHash);
    }

    private getInputTransactionId(originalTransactionId?: Buffer): string | undefined {
        if (!originalTransactionId || originalTransactionId.length === 0) return;
        return originalTransactionId.toString('hex');
    }

    private getTransactionPriority(tx: Transaction<OPNetTransactionTypes>): bigint {
        return this.safeBigInt(tx.priorityFee);
    }

    private safeBigInt(value: unknown): bigint {
        if (typeof value === 'bigint') return value;
        if (typeof value === 'number') return BigInt(value);
        return 0n;
    }
}
