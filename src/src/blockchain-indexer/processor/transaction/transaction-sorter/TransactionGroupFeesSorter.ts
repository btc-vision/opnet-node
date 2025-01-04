import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class TransactionGroupFeesSorter {
    public sortGroupByFees(
        groups: Transaction<OPNetTransactionTypes>[][],
    ): Transaction<OPNetTransactionTypes>[][] {
        return groups.sort((a, b) => {
            const totalA = this.calculateFees(a);
            const totalB = this.calculateFees(b);

            if (totalA < totalB) {
                return 1; // For descending order, return 1 if A is less than B
            } else if (totalA > totalB) {
                return -1; // For descending order, return -1 if A is greater than B
            } else {
                return this.compareHashLists(a, b);
            }
        });
    }

    private calculateFees(group: Transaction<OPNetTransactionTypes>[]): bigint {
        return group.reduce((acc, tx) => acc + tx.burnedFee + tx.reward, 0n);
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
