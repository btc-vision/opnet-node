import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { TransactionGroupBuilder } from '../../src/src/blockchain-indexer/processor/transaction/transaction-sorter/TransactionGroupBuilder.js';
import { Transaction } from '../../src/src/blockchain-indexer/processor/transaction/Transaction.js';
import { OPNetTransactionTypes } from '../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { OPNetConsensus } from '../../src/src/poa/configurations/OPNetConsensus.js';

describe('TransactionGroupBuilder', () => {
    let builder: TransactionGroupBuilder;

    beforeAll(async () => {
        OPNetConsensus.setBlockHeight(100n);
    });

    beforeEach(() => {
        builder = new TransactionGroupBuilder();
    });

    test('returns an empty list when no transactions are provided', () => {
        expect(builder.buildGroups([])).toEqual([]);
    });

    test('groups transactions connected through their inputs into a single component', () => {
        const txA = createMockTransaction('aa11');
        const txB = createMockTransaction('bb22', ['aa11']);
        const txC = createMockTransaction('cc33', ['bb22']);

        const groups = builder.buildGroups([txA, txB, txC]);

        expect(groupIds(groups)).toEqual([['aa11', 'bb22', 'cc33']]);
    });

    test('creates separate groups for disconnected transaction sets', () => {
        const txA = createMockTransaction('aa11');
        const txB = createMockTransaction('bb22', ['aa11']);
        const txC = createMockTransaction('cc33');
        const txD = createMockTransaction('dd44', ['cc33']);

        const groups = builder.buildGroups([txA, txB, txC, txD]);

        expect(groupIds(groups)).toEqual([
            ['aa11', 'bb22'],
            ['cc33', 'dd44'],
        ]);
    });

    test('merges branching dependencies into a single group', () => {
        const parent = createMockTransaction('aa11');
        const childB = createMockTransaction('bb22', ['aa11']);
        const childC = createMockTransaction('cc33', ['aa11']);

        const groups = builder.buildGroups([parent, childB, childC]);

        expect(groupIds(groups)).toEqual([['aa11', 'bb22', 'cc33']]);
    });

    test('merges multiple parents sharing the same child into one group', () => {
        const parentA = createMockTransaction('aa11');
        const parentB = createMockTransaction('bb22');
        const child = createMockTransaction('cc33', ['aa11', 'bb22']);

        const groups = builder.buildGroups([parentA, parentB, child]);

        expect(groupIds(groups)).toEqual([['aa11', 'bb22', 'cc33']]);
    });

    test('handles cyclic dependencies without duplication or infinite loops', () => {
        const txA = createMockTransaction('aa11', ['bb22']);
        const txB = createMockTransaction('bb22', ['aa11']);

        const groups = builder.buildGroups([txA, txB]);

        expect(groupIds(groups)).toEqual([['aa11', 'bb22']]);
    });

    test('ignores inputs that reference transactions outside the provided list', () => {
        const txA = createMockTransaction('aa11');
        const txB = createMockTransaction('bb22', ['ff55']); // dependency not present
        const txC = createMockTransaction('cc33');

        const groups = builder.buildGroups([txA, txB, txC]);

        expect(groupIds(groups)).toEqual([['aa11'], ['bb22'], ['cc33']]);
    });

    test('ignores inputs with missing or empty originalTransactionId', () => {
        const txA = createMockTransaction('aa11', ['']); // empty buffer gets ignored
        const txB = createMockTransaction('bb22', [], [createInput(undefined)]);
        const txC = createMockTransaction('cc33');

        const groups = builder.buildGroups([txA, txB, txC]);

        expect(groupIds(groups)).toEqual([['aa11'], ['bb22'], ['cc33']]);
    });
});

function createMockTransaction(
    transactionId: string,
    parentTransactionIds: string[] = [],
    extraInputs: {
        originalTransactionId?: Buffer;
        outputTransactionIndex: number;
        sequenceId: number;
        transactionInWitness: Buffer[];
    }[] = [],
): Transaction<OPNetTransactionTypes> {
    const inputs = [
        ...parentTransactionIds.map((parentId) =>
            createInput(parentId ? Buffer.from(parentId, 'hex') : Buffer.alloc(0)),
        ),
        ...extraInputs,
    ];

    return {
        transactionIdString: transactionId,
        inputs,
    } as unknown as Transaction<OPNetTransactionTypes>;
}

function createInput(originalTransactionId?: Buffer) {
    return {
        originalTransactionId,
        outputTransactionIndex: 0,
        sequenceId: 0,
        transactionInWitness: [],
    };
}

function groupIds(groups: Transaction<OPNetTransactionTypes>[][]): string[][] {
    return groups.map((group) =>
        group
            .map((tx) => tx.transactionIdString)
            .sort(),
    );
}
