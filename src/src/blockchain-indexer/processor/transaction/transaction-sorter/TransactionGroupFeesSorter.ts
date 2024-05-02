import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { Transaction } from '../Transaction.js';

export class TransactionGroupFeesSorter {
    public sortGroupsByBurnedFees(
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
