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

        const compareByPriority = (aId: string, bId: string): number => {
            const effA = this.computeEffectiveRank(aId, graph, effectiveRankCache, visiting);
            const effB = this.computeEffectiveRank(bId, graph, effectiveRankCache, visiting);
            if (effA !== effB) {
                return effA < effB ? -1 : 1; // lower rank is better
            }

            const rankA = this.getTransactionRank(graph.transactionsById.get(aId)!);
            const rankB = this.getTransactionRank(graph.transactionsById.get(bId)!);
            if (rankA !== rankB) {
                return rankA < rankB ? -1 : 1;
            }

            return this.compareHashes(aId, bId, graph);
        };

        const available: string[] = [];
        graph.inDegree.forEach((degree, txId) => {
            if (degree === 0) {
                available.push(txId);
            }
        });

        const resultIds: string[] = [];
        while (available.length > 0) {
            available.sort(compareByPriority);
            const nextId = available.shift();
            if (!nextId) break;

            resultIds.push(nextId);
            const children = graph.adjacency.get(nextId);
            children?.forEach((childId) => {
                const updated = (graph.inDegree.get(childId) || 0) - 1;
                graph.inDegree.set(childId, updated);
                if (updated === 0) {
                    available.push(childId);
                }
            });
        }

        if (resultIds.length !== graph.transactionsById.size) {
            const remaining = [...graph.transactionsById.keys()].filter(
                (id) => !resultIds.includes(id),
            );
            remaining.sort(compareByPriority);
            resultIds.push(...remaining);
        }

        return resultIds
            .map((id) => graph.transactionsById.get(id))
            .filter((tx): tx is Transaction<OPNetTransactionTypes> => !!tx);
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
        txId: string,
        graph: DependencyGraph,
        cache: Map<string, bigint>,
        visiting: Set<string>,
    ): bigint {
        if (cache.has(txId)) {
            return cache.get(txId)!;
        }

        if (visiting.has(txId)) {
            return this.getTransactionRank(graph.transactionsById.get(txId)!);
        }

        visiting.add(txId);

        let bestRank = this.getTransactionRank(graph.transactionsById.get(txId)!);
        const children = graph.adjacency.get(txId);
        children?.forEach((childId) => {
            const childRank = this.computeEffectiveRank(childId, graph, cache, visiting);
            if (childRank < bestRank) {
                bestRank = childRank;
            }
        });

        visiting.delete(txId);
        cache.set(txId, bestRank);
        return bestRank;
    }

    private compareHashes(aId: string, bId: string, graph: DependencyGraph): number {
        const txA = graph.transactionsById.get(aId);
        const txB = graph.transactionsById.get(bId);
        if (txA?.computedIndexingHash && txB?.computedIndexingHash) {
            const cmp = Buffer.compare(txA.computedIndexingHash, txB.computedIndexingHash);
            if (cmp !== 0) return cmp;
        }
        return aId.localeCompare(bId);
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
