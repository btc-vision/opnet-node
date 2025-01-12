import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';

export class TransactionGroupFeesSorter {
    public sortGroupByFees(
        groups: Transaction<OPNetTransactionTypes>[][],
    ): Transaction<OPNetTransactionTypes>[][] {
        return groups.sort((groupA, groupB) => {
            const rankA = this.calculateRank(groupA);
            const rankB = this.calculateRank(groupB);

            if (rankA < rankB) {
                // rankA is better (smaller)
                return -1;
            } else if (rankA > rankB) {
                // rankB is better (smaller)
                return 1;
            } else {
                // If ranks are equal, fall back to comparing concatenated hashes
                return this.compareHashLists(groupA, groupB);
            }
        });
    }

    /**
     * Computes a single "rank" for a group:
     * rank = (totalGas * GAS_PENALTY_FACTOR) - (totalPriorityFee)
     *
     * Lower rank is better.
     */
    private calculateRank(group: Transaction<OPNetTransactionTypes>[]): bigint {
        const totalGas = this.calculateGasFee(group);
        const totalPriority = this.calculatePriorityFee(group);

        // rank = gas * K - priority
        return totalGas * OPNetConsensus.consensus.GAS.GAS_PENALTY_FACTOR - totalPriority;
    }

    /**
     * Sum of priority fees in the group.
     */
    private calculatePriorityFee(group: Transaction<OPNetTransactionTypes>[]): bigint {
        return group.reduce((acc, tx) => acc + tx.priorityFee, 0n);
    }

    /**
     * Sum of gas usage in sat for the group.
     */
    private calculateGasFee(group: Transaction<OPNetTransactionTypes>[]): bigint {
        return group.reduce((acc, tx) => acc + tx.gasSatFee, 0n);
    }

    /**
     * If ranks are equal, compare the concatenated hashes
     * for deterministic ordering of otherwise identical groups.
     */
    private compareHashLists(
        groupA: Transaction<OPNetTransactionTypes>[],
        groupB: Transaction<OPNetTransactionTypes>[],
    ): number {
        const concatHashA = this.concatenateHashes(groupA);
        const concatHashB = this.concatenateHashes(groupB);
        return Buffer.compare(concatHashA, concatHashB);
    }

    private concatenateHashes(group: Transaction<OPNetTransactionTypes>[]): Buffer {
        return Buffer.concat(group.map((tx) => tx.computedIndexingHash));
    }
}
