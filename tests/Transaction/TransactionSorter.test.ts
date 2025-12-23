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
        const txA = createTransaction('aa11', 100n);
        const txB = createTransaction('bb22', 5n);
        const txC = createTransaction('cc33', 1n, ['aa11']);

        const result = sorter.sortTransactions([txC, txB, txA]);

        expect(order(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('places lower-fee parent immediately before higher-fee child', () => {
        const txA = createTransaction('aa11', 100n, ['cc33']);
        const txB = createTransaction('bb22', 5n);
        const txC = createTransaction('cc33', 1n);

        const result = sorter.sortTransactions([txB, txA, txC]);

        expect(order(result)).toEqual(['cc33', 'aa11', 'bb22']);
    });

    test('handles multiple parents merging into one child', () => {
        const parentA = createTransaction('aa11', 10n);
        const parentB = createTransaction('bb22', 9n);
        const parentC = createTransaction('cc33', 8n);
        const parentD = createTransaction('dd44', 7n);
        const child = createTransaction('ee55', 100n, ['aa11', 'bb22', 'cc33', 'dd44']);

        const result = sorter.sortTransactions([parentB, child, parentD, parentA, parentC]);

        expect(order(result)).toEqual(['aa11', 'bb22', 'cc33', 'dd44', 'ee55']);
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

    /**
     * Mermaid diagram:
     * graph LR
     *     A("#1 (3)") & B("#2 (15)") & C("#3 (5)") & D("#4 (10)") & E("#5 (12)") & F("#6 (25)") & G("#7 (54)") & H("#8 (55)") & I("#9 (45)") & J("#10 (44)") & K("#11 (200)") & L("#12 (150)") & M("#13 (500)") & N("#14 (3)") & O("#15 (50)") & P("#16 (1000)") & Q("#17 (1)") & R("#18 (0)") & S("#19 (5)") & T("#20 (13)") & U("#21 (32)") & V("#22 (64)")
     *
     *     A & B & C --> G
     *     C & D & E --> H
     *     F --> K & I
     *     G --> I
     *     H --> L & J
     *     I --> K & L
     *     J --> M & N & O
     */
    test('sorts complicated dependency tree correctly', () => {
        const tx1 = createTransaction('0001', 3n);
        const tx2 = createTransaction('0002', 15n);
        const tx3 = createTransaction('0003', 5n);
        const tx4 = createTransaction('0004', 10n);
        const tx5 = createTransaction('0005', 12n);
        const tx6 = createTransaction('0006', 25n);
        const tx7 = createTransaction('0007', 54n, ['0001', '0002', '0003']);
        const tx8 = createTransaction('0008', 55n, ['0003', '0004', '0005']);
        const tx9 = createTransaction('0009', 45n, ['0006', '0007']);
        const tx10 = createTransaction('0010', 44n, ['0008']);
        const tx11 = createTransaction('0011', 200n, ['0006', '0009']);
        const tx12 = createTransaction('0012', 150n, ['0008', '0012']);
        const tx13 = createTransaction('0013', 500n, ['0010']);
        const tx14 = createTransaction('0014', 3n, ['0010']);
        const tx15 = createTransaction('0015', 50n, ['0010']);
        const tx16 = createTransaction('0016', 1000n);
        const tx17 = createTransaction('0017', 1n);
        const tx18 = createTransaction('0018', 0n);
        const tx19 = createTransaction('0019', 5n);
        const tx20 = createTransaction('0020', 13n);
        const tx21 = createTransaction('0021', 32n);
        const tx22 = createTransaction('0022', 64n);

        const result = sorter.sortTransactions([
            tx7,
            tx3,
            tx5,
            tx19,
            tx2,
            tx9,
            tx4,
            tx12,
            tx22,
            tx16,
            tx6,
            tx20,
            tx8,
            tx18,
            tx13,
            tx10,
            tx17,
            tx15,
            tx14,
            tx21,
            tx1,
            tx11,
        ]);

        expect(order(result)).toEqual([
            '0016',
            '0005',
            '0004',
            '0003',
            '0008',
            '0010',
            '0013',
            '0006',
            '0002',
            '0001',
            '0007',
            '0009',
            '0011',
            '0012',
            '0022',
            '0015',
            '0021',
            '0020',
            '0019',
            '0014',
            '0017',
            '0018',
        ]);
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
