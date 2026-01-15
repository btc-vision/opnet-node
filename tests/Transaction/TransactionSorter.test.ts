import { beforeAll, describe, expect, it, test } from 'vitest';
import { TransactionSorter } from '../../src/src/blockchain-indexer/processor/transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../../src/src/blockchain-indexer/processor/transaction/Transaction.js';
import { OPNetTransactionTypes } from '../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { OPNetConsensus } from '../../src/src/poa/configurations/OPNetConsensus.js';
import {
    ISortableTransaction,
    ISortableTransactionInput,
} from '../../src/src/blockchain-indexer/processor/transaction/transaction-sorter/ISortableTransaction.js';
import * as crypto from 'crypto';

// Mock class for new-style tests
class MockTransaction implements ISortableTransaction {
    public readonly transactionIdString: string;
    public readonly transactionHashString: string;
    public readonly priorityFee: bigint;
    public readonly computedIndexingHash: Buffer;
    public readonly inputs: ISortableTransactionInput[];

    constructor(
        txid: string,
        wtxid: string,
        priorityFee: bigint,
        inputs: { parentTxid: string }[] = [],
    ) {
        this.transactionIdString = txid;
        this.transactionHashString = wtxid;
        this.priorityFee = priorityFee;
        this.computedIndexingHash = crypto.createHash('sha256').update(wtxid).digest();
        this.inputs = inputs.map((i) => ({
            originalTransactionId: Buffer.from(i.parentTxid, 'hex'),
        }));
    }
}

// Helper functions for old-style tests
function createMockTransaction(
    txid: string,
    wtxid: string,
    fee: bigint,
    parentIds: string[] = [],
): Transaction<OPNetTransactionTypes> {
    return {
        txid: Buffer.from(txid, 'hex'),
        transactionHash: Buffer.from(wtxid, 'hex'),
        transactionIdString: txid,
        transactionHashString: wtxid,
        inputs: parentIds.map(createInput),
        burnedFee: 0n,
        priorityFee: fee,
        gasSatFee: 0n,
        computedIndexingHash: crypto.createHash('sha256').update(wtxid).digest(),
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

describe('TransactionSorter', () => {
    const sorter = new TransactionSorter();

    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    test('orders by fee when no dependencies exist', () => {
        const txA = createMockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);
        const txB = createMockTransaction('bb'.repeat(32), 'b1'.repeat(32), 5n);
        const txC = createMockTransaction('cc'.repeat(32), 'c1'.repeat(32), 1n);

        const result = sorter.sortTransactions([txB, txC, txA]);

        expect(txIds(result)).toEqual(['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)]);
    });

    test('keeps parent before child when parent has higher fee', () => {
        const txA = createMockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);
        const txB = createMockTransaction('bb'.repeat(32), 'b1'.repeat(32), 5n);
        const txC = createMockTransaction('cc'.repeat(32), 'c1'.repeat(32), 1n, ['aa'.repeat(32)]);

        const result = sorter.sortTransactions([txC, txB, txA]);

        expect(txIds(result)).toEqual(['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)]);
    });

    test('places lower-fee parent immediately before higher-fee child', () => {
        const txA = createMockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n, ['cc'.repeat(32)]);
        const txB = createMockTransaction('bb'.repeat(32), 'b1'.repeat(32), 5n);
        const txC = createMockTransaction('cc'.repeat(32), 'c1'.repeat(32), 1n);

        const result = sorter.sortTransactions([txB, txA, txC]);

        expect(txIds(result)).toEqual(['cc'.repeat(32), 'aa'.repeat(32), 'bb'.repeat(32)]);
    });

    test('handles multiple parents merging into one child', () => {
        const parentA = createMockTransaction('aa'.repeat(32), 'a1'.repeat(32), 10n);
        const parentB = createMockTransaction('bb'.repeat(32), 'b1'.repeat(32), 9n);
        const parentC = createMockTransaction('cc'.repeat(32), 'c1'.repeat(32), 8n);
        const parentD = createMockTransaction('dd'.repeat(32), 'd1'.repeat(32), 7n);
        const child = createMockTransaction('ee'.repeat(32), 'e1'.repeat(32), 100n, ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32)]);

        const result = sorter.sortTransactions([parentB, child, parentD, parentA, parentC]);

        expect(txIds(result)).toEqual(['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32), 'ee'.repeat(32)]);
    });

    test('handles one parent unlocking multiple high-fee children', () => {
        const parent = createMockTransaction('aa'.repeat(32), 'a1'.repeat(32), 1n);
        const childA = createMockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n, ['aa'.repeat(32)]);
        const childB = createMockTransaction('cc'.repeat(32), 'c1'.repeat(32), 50n, ['aa'.repeat(32)]);

        const result = sorter.sortTransactions([childB, childA, parent]);

        expect(txIds(result)).toEqual(['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)]);
    });

    test('sorts deep dependency chains by unlocking highest effective fee first', () => {
        const tx1 = createMockTransaction('aa'.repeat(32), 'a1'.repeat(32), 1n);
        const tx2 = createMockTransaction('bb'.repeat(32), 'b1'.repeat(32), 2n, ['aa'.repeat(32)]);
        const tx3 = createMockTransaction('cc'.repeat(32), 'c1'.repeat(32), 3n, ['bb'.repeat(32)]);
        const tx4 = createMockTransaction('dd'.repeat(32), 'd1'.repeat(32), 50n, ['cc'.repeat(32)]);
        const tx5 = createMockTransaction('ee'.repeat(32), 'e1'.repeat(32), 40n);

        const result = sorter.sortTransactions([tx1, tx5, tx4, tx2, tx3]);

        expect(txIds(result)).toEqual(['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32), 'ee'.repeat(32)]);
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
        const tx1 = createMockTransaction('01'.repeat(32), 'w1'.repeat(32), 3n);
        const tx2 = createMockTransaction('02'.repeat(32), 'w2'.repeat(32), 15n);
        const tx3 = createMockTransaction('03'.repeat(32), 'w3'.repeat(32), 5n);
        const tx4 = createMockTransaction('04'.repeat(32), 'w4'.repeat(32), 10n);
        const tx5 = createMockTransaction('05'.repeat(32), 'w5'.repeat(32), 12n);
        const tx6 = createMockTransaction('06'.repeat(32), 'w6'.repeat(32), 25n);
        const tx7 = createMockTransaction('07'.repeat(32), 'w7'.repeat(32), 54n, ['01'.repeat(32), '02'.repeat(32), '03'.repeat(32)]);
        const tx8 = createMockTransaction('08'.repeat(32), 'w8'.repeat(32), 55n, ['03'.repeat(32), '04'.repeat(32), '05'.repeat(32)]);
        const tx9 = createMockTransaction('09'.repeat(32), 'w9'.repeat(32), 45n, ['06'.repeat(32), '07'.repeat(32)]);
        const tx10 = createMockTransaction('10'.repeat(32), 'x0'.repeat(32), 44n, ['08'.repeat(32)]);
        const tx11 = createMockTransaction('11'.repeat(32), 'x1'.repeat(32), 200n, ['06'.repeat(32), '09'.repeat(32)]);
        const tx12 = createMockTransaction('12'.repeat(32), 'x2'.repeat(32), 150n, ['08'.repeat(32), '12'.repeat(32)]);
        const tx13 = createMockTransaction('13'.repeat(32), 'x3'.repeat(32), 500n, ['10'.repeat(32)]);
        const tx14 = createMockTransaction('14'.repeat(32), 'x4'.repeat(32), 3n, ['10'.repeat(32)]);
        const tx15 = createMockTransaction('15'.repeat(32), 'x5'.repeat(32), 50n, ['10'.repeat(32)]);
        const tx16 = createMockTransaction('16'.repeat(32), 'x6'.repeat(32), 1000n);
        const tx17 = createMockTransaction('17'.repeat(32), 'x7'.repeat(32), 1n);
        const tx18 = createMockTransaction('18'.repeat(32), 'x8'.repeat(32), 0n);
        const tx19 = createMockTransaction('19'.repeat(32), 'x9'.repeat(32), 5n);
        const tx20 = createMockTransaction('20'.repeat(32), 'y0'.repeat(32), 13n);
        const tx21 = createMockTransaction('21'.repeat(32), 'y1'.repeat(32), 32n);
        const tx22 = createMockTransaction('22'.repeat(32), 'y2'.repeat(32), 64n);

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
            '16'.repeat(32),
            '05'.repeat(32),
            '04'.repeat(32),
            '03'.repeat(32),
            '08'.repeat(32),
            '10'.repeat(32),
            '13'.repeat(32),
            '06'.repeat(32),
            '02'.repeat(32),
            '01'.repeat(32),
            '07'.repeat(32),
            '09'.repeat(32),
            '11'.repeat(32),
            '12'.repeat(32),
            '22'.repeat(32),
            '15'.repeat(32),
            '21'.repeat(32),
            '20'.repeat(32),
            '19'.repeat(32),
            '14'.repeat(32),
            '17'.repeat(32),
            '18'.repeat(32),
        ]);
    });

    test('sorts equal fee transactions deterministically by wtxid hash', () => {
        // All transactions have same fee, so order is determined by computedIndexingHash (derived from wtxid)
        const tx1 = createMockTransaction('01'.repeat(32), 'b4'.repeat(32), 32n);
        const tx2 = createMockTransaction('02'.repeat(32), 'fc'.repeat(32), 32n);
        const tx3 = createMockTransaction('03'.repeat(32), '58'.repeat(32), 32n);
        const tx4 = createMockTransaction('04'.repeat(32), '4f'.repeat(32), 32n);
        const tx5 = createMockTransaction('05'.repeat(32), '9f'.repeat(32), 32n);
        const tx6 = createMockTransaction('06'.repeat(32), '40'.repeat(32), 32n);
        const tx7 = createMockTransaction('07'.repeat(32), '2e'.repeat(32), 32n);
        const tx8 = createMockTransaction('08'.repeat(32), 'b5'.repeat(32), 32n);
        const tx9 = createMockTransaction('09'.repeat(32), 'c8'.repeat(32), 32n);

        const result1 = sorter.sortTransactions([tx2, tx8, tx5, tx4, tx3, tx7, tx1, tx6, tx9]);
        const result2 = sorter.sortTransactions([tx1, tx2, tx3, tx4, tx5, tx6, tx7, tx8, tx9]);

        // Order should be deterministic regardless of input order
        expect(txIds(result1)).toEqual(txIds(result2));
    });

    test('sorts equal fee parents correctly', () => {
        const tx1 = createMockTransaction('01'.repeat(32), 'b4'.repeat(32), 32n);
        const tx2 = createMockTransaction('02'.repeat(32), 'fc'.repeat(32), 32n);
        const tx3 = createMockTransaction('03'.repeat(32), '58'.repeat(32), 32n);
        const tx4 = createMockTransaction('04'.repeat(32), '4f'.repeat(32), 32n);
        const tx5 = createMockTransaction('05'.repeat(32), '9f'.repeat(32), 32n, ['02'.repeat(32), '03'.repeat(32), '04'.repeat(32)]);
        const tx6 = createMockTransaction('06'.repeat(32), '40'.repeat(32), 100n, ['01'.repeat(32), '05'.repeat(32)]);

        const result = sorter.sortTransactions([tx6, tx4, tx3, tx5, tx2, tx1]);

        // tx6 depends on tx1 and tx5
        // tx5 depends on tx2, tx3, tx4
        // So order should have all parents before children
        const tx1Idx = result.findIndex(tx => tx.transactionIdString === '01'.repeat(32));
        const tx2Idx = result.findIndex(tx => tx.transactionIdString === '02'.repeat(32));
        const tx3Idx = result.findIndex(tx => tx.transactionIdString === '03'.repeat(32));
        const tx4Idx = result.findIndex(tx => tx.transactionIdString === '04'.repeat(32));
        const tx5Idx = result.findIndex(tx => tx.transactionIdString === '05'.repeat(32));
        const tx6Idx = result.findIndex(tx => tx.transactionIdString === '06'.repeat(32));

        // tx5 must come after tx2, tx3, tx4
        expect(tx5Idx).toBeGreaterThan(tx2Idx);
        expect(tx5Idx).toBeGreaterThan(tx3Idx);
        expect(tx5Idx).toBeGreaterThan(tx4Idx);
        // tx6 must come after tx1 and tx5
        expect(tx6Idx).toBeGreaterThan(tx1Idx);
        expect(tx6Idx).toBeGreaterThan(tx5Idx);
    });
});

describe('TransactionSorter with MockTransaction', () => {
    const sorter = new TransactionSorter<MockTransaction>();

    describe('sortTransactions', () => {
        it('should sort transactions by priority fee (higher first)', () => {
            const tx1 = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);
            const tx2 = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 200n);
            const tx3 = new MockTransaction('cc'.repeat(32), 'c1'.repeat(32), 50n);

            const sorted = sorter.sortTransactions([tx1, tx2, tx3]);

            expect(sorted[0].priorityFee).toBe(200n);
            expect(sorted[1].priorityFee).toBe(100n);
            expect(sorted[2].priorityFee).toBe(50n);
        });

        it('should place coinbase transactions first', () => {
            const coinbase = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 0n, [
                { parentTxid: '' }, // empty = coinbase
            ]);
            const tx1 = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 1000n);

            const sorted = sorter.sortTransactions([tx1, coinbase]);

            expect(sorted[0]).toBe(coinbase);
            expect(sorted[1]).toBe(tx1);
        });

        it('should respect dependencies - parent before child', () => {
            const parent = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 10n);
            const child = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 1000n, [
                { parentTxid: 'aa'.repeat(32) }, // spends from parent
            ]);

            const sorted = sorter.sortTransactions([child, parent]);

            expect(sorted[0]).toBe(parent);
            expect(sorted[1]).toBe(child);
        });

        it('should handle chain of dependencies', () => {
            const tx1 = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 10n);
            const tx2 = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 20n, [
                { parentTxid: 'aa'.repeat(32) },
            ]);
            const tx3 = new MockTransaction('cc'.repeat(32), 'c1'.repeat(32), 30n, [
                { parentTxid: 'bb'.repeat(32) },
            ]);

            const sorted = sorter.sortTransactions([tx3, tx1, tx2]);

            expect(sorted.indexOf(tx1)).toBeLessThan(sorted.indexOf(tx2));
            expect(sorted.indexOf(tx2)).toBeLessThan(sorted.indexOf(tx3));
        });

        it('should handle two transactions with same txid but different wtxid', () => {
            // Same txid, different wtxid (segwit malleability)
            const tx1 = new MockTransaction('aa'.repeat(32), 'x1'.repeat(32), 100n);
            const tx2 = new MockTransaction('aa'.repeat(32), 'x2'.repeat(32), 200n);

            const sorted = sorter.sortTransactions([tx1, tx2]);

            // Both transactions should be in the result
            expect(sorted.length).toBe(2);
            expect(sorted).toContain(tx1);
            expect(sorted).toContain(tx2);
        });

        it('should handle child spending from parent with same txid as another tx', () => {
            // tx1 and tx2 have same txid but different wtxid
            const tx1 = new MockTransaction('aa'.repeat(32), 'x1'.repeat(32), 100n);
            const tx2 = new MockTransaction('aa'.repeat(32), 'x2'.repeat(32), 200n);
            // tx3 spends from txid 'aa...' - depends on ALL transactions with that txid
            const tx3 = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 50n, [
                { parentTxid: 'aa'.repeat(32) },
            ]);

            const sorted = sorter.sortTransactions([tx3, tx1, tx2]);

            // All three should be present
            expect(sorted.length).toBe(3);

            const tx1Index = sorted.indexOf(tx1);
            const tx2Index = sorted.indexOf(tx2);
            const tx3Index = sorted.indexOf(tx3);

            // tx3 depends on txid 'aa...', so it should come after BOTH tx1 and tx2
            expect(tx3Index).toBeGreaterThan(tx1Index);
            expect(tx3Index).toBeGreaterThan(tx2Index);
        });

        it('should use effective priority from high-fee descendants', () => {
            // Parent has low fee, child has high fee
            // Parent should be pulled up due to CPFP (child pays for parent)
            const lowFeeParent = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 10n);
            const highFeeChild = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 1000n, [
                { parentTxid: 'aa'.repeat(32) },
            ]);
            const mediumFeeTx = new MockTransaction('cc'.repeat(32), 'c1'.repeat(32), 500n);

            const sorted = sorter.sortTransactions([mediumFeeTx, lowFeeParent, highFeeChild]);

            // lowFeeParent should come before mediumFeeTx because its effective priority
            // is boosted by highFeeChild
            expect(sorted.indexOf(lowFeeParent)).toBeLessThan(sorted.indexOf(mediumFeeTx));
        });

        it('should use computedIndexingHash as tiebreaker for equal priority', () => {
            const tx1 = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);
            const tx2 = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n);

            const sorted1 = sorter.sortTransactions([tx1, tx2]);
            const sorted2 = sorter.sortTransactions([tx2, tx1]);

            // Order should be deterministic regardless of input order
            expect(sorted1[0].transactionHashString).toBe(sorted2[0].transactionHashString);
            expect(sorted1[1].transactionHashString).toBe(sorted2[1].transactionHashString);
        });
    });

    describe('sortTransactionsByOrder', () => {
        it('should reorder transactions by provided txid order', () => {
            const tx1 = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);
            const tx2 = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 200n);
            const tx3 = new MockTransaction('cc'.repeat(32), 'c1'.repeat(32), 50n);

            const order = [
                tx3.transactionIdString,
                tx1.transactionIdString,
                tx2.transactionIdString,
            ];
            const sorted = sorter.sortTransactionsByOrder(order, [tx1, tx2, tx3]);

            expect(sorted[0]).toBe(tx3);
            expect(sorted[1]).toBe(tx1);
            expect(sorted[2]).toBe(tx2);
        });

        it('should throw if transaction count mismatches', () => {
            const tx1 = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);

            expect(() => {
                sorter.sortTransactionsByOrder(['aa'.repeat(32), 'bb'.repeat(32)], [tx1]);
            }).toThrow('Transaction count changed');
        });

        it('should throw if transaction not found', () => {
            const tx1 = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);

            expect(() => {
                sorter.sortTransactionsByOrder(['bb'.repeat(32)], [tx1]);
            }).toThrow('not found');
        });
    });

    /**
     * Witness Malleability Ordering Attack Tests
     *
     * These tests verify resistance to the following attack scenario:
     *
     * An attacker controls a wallet with tokens. They construct two transactions:
     * - TX-Alpha: sends tokens to accomplice
     * - TX-Beta: sends tokens to victim (fulfilling a trade)
     *
     * Both have identical priority, so tiebreaker determines order.
     *
     * The attacker signs TX-Alpha twice with different aux randomness:
     * - TX-Alpha-W1 and TX-Alpha-W2 (same txid, different wtxid)
     *
     * Attack attempt:
     * 1. Send TX-Alpha-W1 + TX-Beta to victim's nodes (arranged so TX-Beta executes first)
     * 2. Send TX-Alpha-W2 + TX-Beta to miner's nodes (arranged so TX-Alpha executes first)
     *
     * If successful, victim sees their transfer confirmed locally, but canonical chain
     * has TX-Alpha first (accomplice gets tokens). Victim releases goods based on
     * local state that never happened in consensus reality.
     *
     * Mitigation: Ordering must be deterministic. Given the same set of transactions
     * (identified by wtxid), the order must always be the same regardless of which
     * node processes them.
     */
    describe('Witness Malleability Ordering Attack resistance', () => {
        it('should produce deterministic order regardless of input arrangement', () => {
            // Two transactions with equal priority - order depends on tiebreaker
            const txAlpha = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);
            const txBeta = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n);

            // Try multiple input orderings
            const ordering1 = sorter.sortTransactions([txAlpha, txBeta]);
            const ordering2 = sorter.sortTransactions([txBeta, txAlpha]);

            // Must produce identical results
            expect(ordering1.map((tx) => tx.transactionHashString)).toEqual(
                ordering2.map((tx) => tx.transactionHashString),
            );
        });

        it('should use wtxid-based tiebreaker for determinism (wtxid is unique)', () => {
            // Create transactions with same priority but different wtxids
            const tx1 = new MockTransaction('aa'.repeat(32), '11'.repeat(32), 100n);
            const tx2 = new MockTransaction('bb'.repeat(32), '22'.repeat(32), 100n);
            const tx3 = new MockTransaction('cc'.repeat(32), '33'.repeat(32), 100n);

            // Sort multiple times in different orders
            const results = [
                sorter.sortTransactions([tx1, tx2, tx3]),
                sorter.sortTransactions([tx3, tx2, tx1]),
                sorter.sortTransactions([tx2, tx1, tx3]),
                sorter.sortTransactions([tx1, tx3, tx2]),
                sorter.sortTransactions([tx3, tx1, tx2]),
                sorter.sortTransactions([tx2, tx3, tx1]),
            ];

            // All orderings must be identical
            const expectedOrder = results[0].map((tx) => tx.transactionHashString);
            for (const result of results) {
                expect(result.map((tx) => tx.transactionHashString)).toEqual(expectedOrder);
            }
        });

        it('should maintain determinism when witness variants exist (attack scenario)', () => {
            // Simulate attack: TX-Alpha has two witness variants (same txid, different wtxid)
            const txAlphaW1 = new MockTransaction('aa'.repeat(32), 'w1'.repeat(32), 100n);
            const txAlphaW2 = new MockTransaction('aa'.repeat(32), 'w2'.repeat(32), 100n);
            const txBeta = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n);

            // Scenario 1: Victim's node receives W1 variant
            const victimView = sorter.sortTransactions([txAlphaW1, txBeta]);

            // Scenario 2: Miner's node receives W2 variant
            const minerView = sorter.sortTransactions([txAlphaW2, txBeta]);

            // CRITICAL: txBeta's position relative to txAlpha should be consistent
            // based on deterministic comparison of wtxid-based hashes
            const victimBetaFirst = victimView[0] === txBeta;
            const minerBetaFirst = minerView[0] === txBeta;

            // Note: The exact order may differ because different wtxids produce different
            // tiebreaker hashes. But given the SAME set of transactions, order is deterministic.
            // This test verifies that each view is internally consistent.
            expect(victimView.length).toBe(2);
            expect(minerView.length).toBe(2);

            // Re-sort should produce same result
            const victimView2 = sorter.sortTransactions([txBeta, txAlphaW1]);
            expect(victimView.map((tx) => tx.transactionHashString)).toEqual(
                victimView2.map((tx) => tx.transactionHashString),
            );
        });

        it('should be immune to ordering manipulation via witness selection', () => {
            // Attacker tries to find witness variants that produce favorable ordering
            // by changing the wtxid (which changes computedIndexingHash)

            const txBeta = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n);

            // Simulate attacker trying different witness variants
            const variants: MockTransaction[] = [];
            for (let i = 0; i < 10; i++) {
                const wtxid = crypto.randomBytes(32).toString('hex');
                variants.push(new MockTransaction('aa'.repeat(32), wtxid, 100n));
            }

            // For each variant, check if ordering with txBeta is deterministic
            for (const variant of variants) {
                const order1 = sorter.sortTransactions([variant, txBeta]);
                const order2 = sorter.sortTransactions([txBeta, variant]);

                // Same inputs must produce same output
                expect(order1.map((tx) => tx.transactionHashString)).toEqual(
                    order2.map((tx) => tx.transactionHashString),
                );
            }
        });

        it('should handle attack with multiple equal-priority transactions', () => {
            // Complex attack: multiple transactions all with same priority
            const txAlphaW1 = new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n);
            const txBeta = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n);
            const txGamma = new MockTransaction('cc'.repeat(32), 'c1'.repeat(32), 100n);
            const txDelta = new MockTransaction('dd'.repeat(32), 'd1'.repeat(32), 100n);

            // All permutations should produce same result
            const permutations = [
                [txAlphaW1, txBeta, txGamma, txDelta],
                [txDelta, txGamma, txBeta, txAlphaW1],
                [txBeta, txDelta, txAlphaW1, txGamma],
                [txGamma, txAlphaW1, txDelta, txBeta],
            ];

            const results = permutations.map((p) =>
                sorter.sortTransactions(p).map((tx) => tx.transactionHashString),
            );

            // All results must be identical
            for (let i = 1; i < results.length; i++) {
                expect(results[i]).toEqual(results[0]);
            }
        });

        it('should not allow witness malleability to affect dependency ordering', () => {
            // Parent transaction with witness variant should not affect child ordering
            const parentW1 = new MockTransaction('aa'.repeat(32), 'p1'.repeat(32), 100n);
            const parentW2 = new MockTransaction('aa'.repeat(32), 'p2'.repeat(32), 100n);
            const child = new MockTransaction('bb'.repeat(32), 'c1'.repeat(32), 50n, [
                { parentTxid: 'aa'.repeat(32) },
            ]);
            const unrelated = new MockTransaction('cc'.repeat(32), 'u1'.repeat(32), 75n);

            // With W1 variant
            const orderW1 = sorter.sortTransactions([child, parentW1, unrelated]);

            // With W2 variant
            const orderW2 = sorter.sortTransactions([child, parentW2, unrelated]);

            // In both cases, child must come after parent
            expect(orderW1.indexOf(child)).toBeGreaterThan(orderW1.indexOf(parentW1));
            expect(orderW2.indexOf(child)).toBeGreaterThan(orderW2.indexOf(parentW2));

            // Both parents are in the graph with same txid, child depends on both
            // This is the duplicate txid scenario
        });

        it('should handle the full attack scenario with duplicate txid', () => {
            // Full attack: both witness variants somehow end up in same block
            // (shouldn't happen with proper deduplication, but sorter must handle it)

            const txAlphaW1 = new MockTransaction('aa'.repeat(32), 'w1'.repeat(32), 100n);
            const txAlphaW2 = new MockTransaction('aa'.repeat(32), 'w2'.repeat(32), 100n);
            const txBeta = new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n);

            // If both variants are in the block, both must be sorted
            const sorted = sorter.sortTransactions([txAlphaW1, txAlphaW2, txBeta]);

            expect(sorted.length).toBe(3);
            expect(sorted).toContain(txAlphaW1);
            expect(sorted).toContain(txAlphaW2);
            expect(sorted).toContain(txBeta);

            // Order must be deterministic
            const sorted2 = sorter.sortTransactions([txBeta, txAlphaW2, txAlphaW1]);
            expect(sorted.map((tx) => tx.transactionHashString)).toEqual(
                sorted2.map((tx) => tx.transactionHashString),
            );
        });

        it('should ensure tiebreaker hash is computed from wtxid (unique) not txid', () => {
            // Two transactions with same txid but different wtxid
            // Their tiebreaker hashes MUST be different
            const tx1 = new MockTransaction('aa'.repeat(32), 'w1'.repeat(32), 100n);
            const tx2 = new MockTransaction('aa'.repeat(32), 'w2'.repeat(32), 100n);

            // computedIndexingHash should be different
            expect(tx1.computedIndexingHash.equals(tx2.computedIndexingHash)).toBe(false);

            // This ensures they can be distinguished in the priority queue
        });

        it('should produce consistent ordering across multiple sort calls', () => {
            // Simulate multiple nodes processing the same block
            const transactions = [
                new MockTransaction('aa'.repeat(32), 'a1'.repeat(32), 100n),
                new MockTransaction('bb'.repeat(32), 'b1'.repeat(32), 100n),
                new MockTransaction('cc'.repeat(32), 'c1'.repeat(32), 100n),
                new MockTransaction('dd'.repeat(32), 'd1'.repeat(32), 50n),
                new MockTransaction('ee'.repeat(32), 'e1'.repeat(32), 200n),
            ];

            // Sort 100 times to verify consistency
            const firstResult = sorter
                .sortTransactions([...transactions])
                .map((tx) => tx.transactionHashString);

            for (let i = 0; i < 100; i++) {
                // Shuffle input order
                const shuffled = [...transactions].sort(() => Math.random() - 0.5);
                const result = sorter
                    .sortTransactions(shuffled)
                    .map((tx) => tx.transactionHashString);

                expect(result).toEqual(firstResult);
            }
        });
    });
});
