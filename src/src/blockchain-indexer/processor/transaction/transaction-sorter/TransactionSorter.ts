import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';

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
    public sortTransactions(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        const initialLength = transactions.length;

        // Filter block rewards and non-block rewards
        const blockRewards = transactions.filter((t) =>
            t.inputs.some((input) => input.originalTransactionId.length === 0),
        );

        const nonBlockRewards = transactions.filter((t) =>
            t.inputs.every((input) => input.originalTransactionId.length !== 0),
        );

        const sortedNonRewards = this.sortWithDependencies(nonBlockRewards);
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

    private sortWithDependencies(
        transactions: Transaction<OPNetTransactionTypes>[],
    ): Transaction<OPNetTransactionTypes>[] {
        const graph = this.buildDependencyGraph(transactions);
        const effectiveRankCache = new Map<string, bigint>();
        const visiting = new Set<string>();

        const compareByPriority = (
            a: Transaction<OPNetTransactionTypes>,
            b: Transaction<OPNetTransactionTypes>,
        ): number => {
            const effA = this.computeEffectiveRank(a, graph, effectiveRankCache, visiting);
            const effB = this.computeEffectiveRank(b, graph, effectiveRankCache, visiting);
            if (effA !== effB) {
                return effA < effB ? -1 : 1; // lower rank is better
            }

            const rankA = this.getTransactionRank(a);
            const rankB = this.getTransactionRank(b);
            if (rankA !== rankB) {
                return rankA < rankB ? -1 : 1;
            }

            return this.compareHashes(a, b);
        };

        const availableTxs: Transaction<OPNetTransactionTypes>[] = [];
        graph.inDegree.forEach((degree, txId) => {
            if (degree === 0) {
                const tx = this.getTx(txId, graph);
                availableTxs.push(tx);
            }
        });

        const resultTxs: Transaction<OPNetTransactionTypes>[] = [];
        while (availableTxs.length > 0) {
            availableTxs.sort(compareByPriority);
            const nextTx = availableTxs.shift();
            if (!nextTx) break;

            resultTxs.push(nextTx);
            const children = graph.adjacency.get(nextTx.transactionIdString);
            children?.forEach((childId) => {
                const updated = (graph.inDegree.get(childId) || 0) - 1;
                graph.inDegree.set(childId, updated);
                if (updated === 0) {
                    const child = this.getTx(childId, graph);
                    availableTxs.push(child);
                }
            });
        }

        if (resultTxs.length !== graph.transactionsById.size) {
            const remaining = [...graph.transactionsById.values()].filter(
                (txA) =>
                    !resultTxs.some((txB) => txA.transactionIdString === txB.transactionIdString),
            );
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

    private computeEffectiveRank(
        tx: Transaction<OPNetTransactionTypes>,
        graph: DependencyGraph,
        cache: Map<string, bigint>,
        visiting: Set<string>,
    ): bigint {
        const txId = tx.transactionIdString;

        const cachedRank = cache.get(txId);
        if (cachedRank != null) {
            return cachedRank;
        }

        if (visiting.has(txId)) {
            return this.getTransactionRank(tx);
        }

        visiting.add(txId);

        let bestRank = this.getTransactionRank(tx);
        const children = graph.adjacency.get(txId);
        children?.forEach((childId) => {
            const child = this.getTx(childId, graph);
            const childRank = this.computeEffectiveRank(child, graph, cache, visiting);
            if (childRank < bestRank) {
                bestRank = childRank;
            }
        });

        visiting.delete(txId);
        cache.set(txId, bestRank);
        return bestRank;
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

    private getTransactionRank(tx: Transaction<OPNetTransactionTypes>): bigint {
        const gas = this.safeBigInt(tx.gasSatFee);
        const priority = this.safeBigInt(tx.priorityFee);
        return gas * OPNetConsensus.consensus.GAS.GAS_PENALTY_FACTOR - priority;
    }

    private safeBigInt(value: unknown): bigint {
        if (typeof value === 'bigint') return value;
        if (typeof value === 'number') return BigInt(value);
        return 0n;
    }
}
