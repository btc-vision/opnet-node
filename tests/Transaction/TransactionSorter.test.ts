import { beforeAll, describe, expect, test } from 'vitest';
import { TransactionSorter } from '../../src/src/blockchain-indexer/processor/transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../../src/src/blockchain-indexer/processor/transaction/Transaction.js';
import { OPNetTransactionTypes } from '../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { OPNetConsensus } from '../../src/src/poc/configurations/OPNetConsensus.js';

describe('TransactionSorter', () => {
    const sorter = new TransactionSorter();

    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    test('orders by fee when no dependencies exist', () => {
        const txA = createMockTransaction('aa11', 100n);
        const txB = createMockTransaction('bb22', 5n);
        const txC = createMockTransaction('cc33', 1n);

        const result = sorter.sortTransactions([txB, txC, txA]);

        expect(txIds(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('keeps parent before child when parent has higher fee', () => {
        const txA = createMockTransaction('aa11', 100n);
        const txB = createMockTransaction('bb22', 5n);
        const txC = createMockTransaction('cc33', 1n, ['aa11']);

        const result = sorter.sortTransactions([txC, txB, txA]);

        expect(txIds(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('places lower-fee parent immediately before higher-fee child', () => {
        const txA = createMockTransaction('aa11', 100n, ['cc33']);
        const txB = createMockTransaction('bb22', 5n);
        const txC = createMockTransaction('cc33', 1n);

        const result = sorter.sortTransactions([txB, txA, txC]);

        expect(txIds(result)).toEqual(['cc33', 'aa11', 'bb22']);
    });

    test('handles multiple parents merging into one child', () => {
        const parentA = createMockTransaction('aa11', 10n);
        const parentB = createMockTransaction('bb22', 9n);
        const parentC = createMockTransaction('cc33', 8n);
        const parentD = createMockTransaction('dd44', 7n);
        const child = createMockTransaction('ee55', 100n, ['aa11', 'bb22', 'cc33', 'dd44']);

        const result = sorter.sortTransactions([parentB, child, parentD, parentA, parentC]);

        expect(txIds(result)).toEqual(['aa11', 'bb22', 'cc33', 'dd44', 'ee55']);
    });

    test('handles one parent unlocking multiple high-fee children', () => {
        const parent = createMockTransaction('aa11', 1n);
        const childA = createMockTransaction('bb22', 100n, ['aa11']);
        const childB = createMockTransaction('cc33', 50n, ['aa11']);

        const result = sorter.sortTransactions([childB, childA, parent]);

        expect(txIds(result)).toEqual(['aa11', 'bb22', 'cc33']);
    });

    test('sorts deep dependency chains by unlocking highest effective fee first', () => {
        const tx1 = createMockTransaction('aa11', 1n);
        const tx2 = createMockTransaction('bb22', 2n, ['aa11']);
        const tx3 = createMockTransaction('cc33', 3n, ['bb22']);
        const tx4 = createMockTransaction('dd44', 50n, ['cc33']);
        const tx5 = createMockTransaction('ee55', 40n);

        const result = sorter.sortTransactions([tx1, tx5, tx4, tx2, tx3]);

        expect(txIds(result)).toEqual(['aa11', 'bb22', 'cc33', 'dd44', 'ee55']);
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
        const tx1 = createMockTransaction('0001', 3n);
        const tx2 = createMockTransaction('0002', 15n);
        const tx3 = createMockTransaction('0003', 5n);
        const tx4 = createMockTransaction('0004', 10n);
        const tx5 = createMockTransaction('0005', 12n);
        const tx6 = createMockTransaction('0006', 25n);
        const tx7 = createMockTransaction('0007', 54n, ['0001', '0002', '0003']);
        const tx8 = createMockTransaction('0008', 55n, ['0003', '0004', '0005']);
        const tx9 = createMockTransaction('0009', 45n, ['0006', '0007']);
        const tx10 = createMockTransaction('0010', 44n, ['0008']);
        const tx11 = createMockTransaction('0011', 200n, ['0006', '0009']);
        const tx12 = createMockTransaction('0012', 150n, ['0008', '0012']);
        const tx13 = createMockTransaction('0013', 500n, ['0010']);
        const tx14 = createMockTransaction('0014', 3n, ['0010']);
        const tx15 = createMockTransaction('0015', 50n, ['0010']);
        const tx16 = createMockTransaction('0016', 1000n);
        const tx17 = createMockTransaction('0017', 1n);
        const tx18 = createMockTransaction('0018', 0n);
        const tx19 = createMockTransaction('0019', 5n);
        const tx20 = createMockTransaction('0020', 13n);
        const tx21 = createMockTransaction('0021', 32n);
        const tx22 = createMockTransaction('0022', 64n);

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

        expect(txIds(result)).toEqual([
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

    test('sorts equal fee transactions correctly', () => {
        const tx1 = createMockTransaction('0001', 32n, [], 'b413');
        const tx2 = createMockTransaction('0002', 32n, [], 'fcf0');
        const tx3 = createMockTransaction('0003', 32n, [], '583c');
        const tx4 = createMockTransaction('0004', 32n, [], '4f35');
        const tx5 = createMockTransaction('0005', 32n, [], '9f1a');
        const tx6 = createMockTransaction('0006', 32n, [], '40d8');
        const tx7 = createMockTransaction('0007', 32n, [], '2ecd');
        const tx8 = createMockTransaction('0008', 32n, [], 'b4c4');
        const tx9 = createMockTransaction('0009', 32n, [], 'c874');

        const result = sorter.sortTransactions([tx2, tx8, tx5, tx4, tx3, tx7, tx1, tx6, tx9]);

        expect(txIds(result)).toEqual([
            '0007',
            '0006',
            '0004',
            '0003',
            '0005',
            '0001',
            '0008',
            '0009',
            '0002',
        ]);
    });

    test('sorts equal fee parents correctly', () => {
        const tx1 = createMockTransaction('0001', 32n, [], 'b413');
        const tx2 = createMockTransaction('0002', 32n, [], 'fcf0');
        const tx3 = createMockTransaction('0003', 32n, [], '583c');
        const tx4 = createMockTransaction('0004', 32n, [], '4f35');
        const tx5 = createMockTransaction('0005', 32n, ['0002', '0003', '0004'], '9f1a');
        const tx6 = createMockTransaction('0006', 100n, ['0001', '0005'], '40d8');

        const result = sorter.sortTransactions([tx6, tx4, tx3, tx5, tx2, tx1]);

        expect(txIds(result)).toEqual(['0004', '0003', '0001', '0002', '0005', '0006']);
    });
});

function createMockTransaction(
    id: string,
    fee: bigint,
    parentIds: string[] = [],
    computedIndexingHash: string | null = null,
): Transaction<OPNetTransactionTypes> {
    return {
        txid: Buffer.from(id, 'hex'),
        transactionHash: Buffer.from(id, 'hex'),
        transactionIdString: id,
        inputs: parentIds.map(createInput),
        burnedFee: 0n,
        priorityFee: fee,
        gasSatFee: 0n,
        computedIndexingHash: computedIndexingHash
            ? Buffer.from(computedIndexingHash, 'hex')
            : null,
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

function txIds(transactions: Transaction<OPNetTransactionTypes>[]): string[] {
    return transactions.map((tx) => tx.transactionIdString);
}
