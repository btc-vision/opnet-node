import { ISortableTransaction } from './ISortableTransaction.js';
import { PriorityQueue } from '@datastructures-js/priority-queue';

type DependencyGraph<T extends ISortableTransaction> = {
    transactionsByHash: Map<string, T>; // keyed by wtxid (unique)
    txidToHashes: Map<string, Set<string>>; // txid -> Set of wtxids (handles same txid, different wtxid)
    adjacency: Map<string, Set<string>>; // keyed by wtxid
    inDegree: Map<string, number>; // keyed by wtxid
};

/**
 * The goal of this class is to sort transactions in bitcoin blocks where their position in a block is topologically sorted.
 * We have to sort transactions in a block to ensure that the transactions are processed in the correct order.
 *
 * The chosen strategy is to sort transactions by their fee and priority fee.
 * Transactions with the same fee will get stored via a tie-breaking hash.
 */
export class TransactionSorter<T extends ISortableTransaction> {
    public sortTransactionsByOrder(transactionIds: string[], transactions: T[]): T[] {
        if (transactionIds.length !== transactions.length) {
            throw new Error(
                `Transaction count changed during sorting. Expected ${transactions.length}, got ${transactionIds.length}.`,
            );
        }

        const newOrder: T[] = [];
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

    public sortTransactions(transactions: T[]): T[] {
        const initialLength = transactions.length;

        // Keep coinbase-like rewards first, then sort all remaining txs by dependency-aware priority.
        const { blockRewards, nonBlockRewards } = this.partitionByRewardStatus(transactions);

        const sortedNonRewards = this.sortByFeeWithDependencies(nonBlockRewards);
        const finalList: T[] = [...blockRewards, ...sortedNonRewards];

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
    private partitionByRewardStatus(transactions: T[]) {
        const blockRewards = transactions.filter((t) =>
            t.inputs.some((input) => !this.getInputTxId(input.originalTransactionId)),
        );

        const nonBlockRewards = transactions.filter((t) =>
            t.inputs.every((input) => !!this.getInputTxId(input.originalTransactionId)),
        );

        return { blockRewards, nonBlockRewards };
    }

    /**
     * Sorts transactions based on their priority, but always placing parents before children.
     */
    private sortByFeeWithDependencies(transactions: T[]): T[] {
        const graph = this.buildDependencyGraph(transactions);
        const effectivePriorityCache = new Map<string, bigint>();
        const visiting = new Set<string>();

        const compareByPriority = this.createPriorityComparator(
            graph,
            effectivePriorityCache,
            visiting,
        );

        const availableTxs = new PriorityQueue<T>(compareByPriority);

        graph.inDegree.forEach((degree, hash) => {
            if (degree === 0) {
                const tx = graph.transactionsByHash.get(hash);
                if (tx) availableTxs.enqueue(tx);
            }
        });

        const resultTxs: T[] = [];

        // Classic topological traversal that always emits the most valuable available tx next.
        while (!availableTxs.isEmpty()) {
            const nextTx = availableTxs.dequeue() as T;

            resultTxs.push(nextTx);
            const children = graph.adjacency.get(nextTx.transactionHashString);
            children?.forEach((childHash) => {
                const updated = (graph.inDegree.get(childHash) || 0) - 1;
                graph.inDegree.set(childHash, updated);
                if (updated === 0) {
                    const child = graph.transactionsByHash.get(childHash);
                    if (child) availableTxs.enqueue(child);
                }
            });
        }

        if (resultTxs.length !== graph.transactionsByHash.size) {
            const remaining = [...graph.transactionsByHash.values()].filter(
                (txA) =>
                    !resultTxs.some(
                        (txB) => txA.transactionHashString === txB.transactionHashString,
                    ),
            );

            remaining.sort(compareByPriority);
            resultTxs.push(...remaining);
        }

        return resultTxs;
    }

    private buildDependencyGraph(transactions: T[]): DependencyGraph<T> {
        const transactionsByHash = new Map<string, T>();
        const txidToHashes = new Map<string, Set<string>>();
        const adjacency = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();

        // Key by wtxid (unique), map txid -> Set of wtxids (handles duplicate txids)
        for (const tx of transactions) {
            const hash = tx.transactionHashString;
            const txid = tx.transactionIdString;

            transactionsByHash.set(hash, tx);

            let hashSet = txidToHashes.get(txid);
            if (!hashSet) {
                hashSet = new Set<string>();
                txidToHashes.set(txid, hashSet);
            }
            hashSet.add(hash);

            adjacency.set(hash, new Set<string>());
            inDegree.set(hash, 0);
        }

        for (const tx of transactions) {
            const childHash = tx.transactionHashString;

            for (const input of tx.inputs) {
                const parentTxId = this.getInputTxId(input.originalTransactionId);
                if (!parentTxId) {
                    continue;
                }

                // Find ALL parents by txid (handles duplicate txids)
                const parentHashes = txidToHashes.get(parentTxId);
                if (!parentHashes) {
                    continue;
                }

                for (const parentHash of parentHashes) {
                    if (parentHash === childHash) {
                        continue;
                    }

                    const children = adjacency.get(parentHash);
                    if (children && !children.has(childHash)) {
                        children.add(childHash);
                        inDegree.set(childHash, (inDegree.get(childHash) || 0) + 1);
                    }
                }
            }
        }

        return { transactionsByHash, txidToHashes, adjacency, inDegree };
    }

    private createPriorityComparator(
        graph: DependencyGraph<T>,
        effectivePriorityCache: Map<string, bigint>,
        visiting: Set<string>,
    ) {
        return (a: T, b: T) => {
            const effA = this.computeEffectivePriority(a, graph, effectivePriorityCache, visiting);
            const effB = this.computeEffectivePriority(b, graph, effectivePriorityCache, visiting);
            if (effA !== effB) {
                return effA > effB ? -1 : 1;
            }

            if (a.priorityFee !== b.priorityFee) {
                return a.priorityFee > b.priorityFee ? -1 : 1;
            }

            return Buffer.compare(a.computedIndexingHash, b.computedIndexingHash);
        };
    }

    /*
     * Returns the best (highest) priority reachable from this transaction, so high-fee descendants
     * pull their parents earlier in the ordering.
     */
    private computeEffectivePriority(
        tx: T,
        graph: DependencyGraph<T>,
        cache: Map<string, bigint>,
        visiting: Set<string>,
    ): bigint {
        const hash = tx.transactionHashString;

        const cachedPriority = cache.get(hash);
        if (cachedPriority != null) {
            return cachedPriority;
        }

        if (visiting.has(hash)) {
            return tx.priorityFee;
        }

        visiting.add(hash);

        let bestPriority = tx.priorityFee;
        const children = graph.adjacency.get(hash);
        children?.forEach((childHash) => {
            const child = graph.transactionsByHash.get(childHash);
            if (child) {
                const childPriority = this.computeEffectivePriority(child, graph, cache, visiting);
                if (childPriority > bestPriority) {
                    bestPriority = childPriority;
                }
            }
        });

        visiting.delete(hash);
        cache.set(hash, bestPriority);
        return bestPriority;
    }

    private getInputTxId(
        originalTransactionId?: Buffer | { buffer: ArrayBuffer | Uint8Array },
    ): string | undefined {
        if (!originalTransactionId) return undefined;

        let buffer: Buffer;
        if (Buffer.isBuffer(originalTransactionId)) {
            buffer = originalTransactionId;
        } else if ('buffer' in originalTransactionId && originalTransactionId.buffer) {
            const raw = originalTransactionId.buffer;
            buffer = Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
        } else {
            return undefined;
        }

        if (buffer.length === 0) return undefined;
        return buffer.toString('hex');
    }
}
