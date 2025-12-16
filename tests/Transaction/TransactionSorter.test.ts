import { beforeAll, describe, expect, test } from 'vitest';
import { TransactionSorter } from '../../src/src/blockchain-indexer/processor/transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../../src/src/blockchain-indexer/processor/transaction/Transaction.js';
import { OPNetTransactionTypes } from '../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { OPNetConsensus } from '../../src/src/poa/configurations/OPNetConsensus.js';

describe('TransactionSorter', () => {
    const sorter = new TransactionSorter();

    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    test('orders by fee when no dependencies exist', () => {
        const txA = createTransaction('aa11', 100n);
        const txB = createTransaction('bb22', 5n);
        const txC = createTransaction('cc33', 1n);

        const result = sorter.sortTransactions([txB, txC, txA]);

        expect(order(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('keeps parent before child when parent has higher fee', () => {
        // Example: A=100, B=5, C=1 with C dependent on A => ABC
        const txA = createTransaction('aa11', 100n);
        const txB = createTransaction('bb22', 5n);
        const txC = createTransaction('cc33', 1n, ['aa11']);

        const result = sorter.sortTransactions([txC, txB, txA]);

        expect(order(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('places lower-fee parent immediately before higher-fee child', () => {
        // Example: D=100 depends on F=1, E=5 => FDE
        const txD = createTransaction('dd44', 100n, ['ff55']);
        const txE = createTransaction('ee66', 5n);
        const txF = createTransaction('ff55', 1n);

        const result = sorter.sortTransactions([txE, txD, txF]);

        expect(order(result)).toEqual(['ff55', 'dd44', 'ee66']);
    });

    test('handles multiple parents merging into one child', () => {
        const parentA = createTransaction('aa11', 10n);
        const parentB = createTransaction('bb22', 9n);
        const child = createTransaction('cc33', 100n, ['aa11', 'bb22']);

        const result = sorter.sortTransactions([child, parentB, parentA]);

        expect(order(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('handles one parent unlocking multiple high-fee children', () => {
        const parent = createTransaction('aa11', 1n);
        const childA = createTransaction('bb22', 100n, ['aa11']);
        const childB = createTransaction('cc33', 50n, ['aa11']);

        const result = sorter.sortTransactions([childB, childA, parent]);

        expect(order(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('sorts deep dependency chains by unlocking highest effective fee first', () => {
        const tx1 = createTransaction('aa11', 1n);
        const tx2 = createTransaction('bb22', 2n, ['aa11']);
        const tx3 = createTransaction('cc33', 3n, ['bb22']);
        const tx4 = createTransaction('dd44', 50n, ['cc33']);
        const tx5 = createTransaction('ee55', 40n);

        const result = sorter.sortTransactions([tx1, tx5, tx4, tx2, tx3]);

        expect(order(result)).toEqual(['aa11', 'bb22', 'cc33', 'dd44', 'ee55']);
    });
});

function createTransaction(
    id: string,
    fee: bigint,
    parentIds: string[] = [],
): Transaction<OPNetTransactionTypes> {
    return {
        transactionIdString: id,
        inputs: parentIds.map(createInput),
        burnedFee: 0n,
        priorityFee: fee,
        gasSatFee: 0n,
    } as unknown as Transaction<OPNetTransactionTypes>;
}

function createInput(parentId: string) {
    return {
        originalTransactionId: Buffer.from(parentId, 'hex'),
        outputTransactionIndex: 0,
        sequenceId: 0,
        transactionInWitness: [],
    };
}

function order(transactions: Transaction<OPNetTransactionTypes>[]): string[] {
    return transactions.map((tx) => tx.transactionIdString);
}
