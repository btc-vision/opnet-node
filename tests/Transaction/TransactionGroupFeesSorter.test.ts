import { networks } from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionGroupFeesSorter } from '../../src/src/blockchain-indexer/processor/transaction/transaction-sorter/TransactionGroupFeesSorter.js';
import { Transaction } from '../../src/src/blockchain-indexer/processor/transaction/Transaction.js';
import { CreateFakeTransaction } from './TransactionCreatorHelper.js';
import { beforeAll, beforeEach, describe, test } from 'vitest';
import { OPNetConsensus } from '../../src/src/poa/configurations/OPNetConsensus.js';

describe('TransactionGroupFeesSorter', () => {
    let sorter: TransactionGroupFeesSorter;

    beforeAll(() => {
        // Initialize OPNetConsensus before tests run
        if (!OPNetConsensus.hasConsensus()) {
            OPNetConsensus.setBlockHeight(0n);
        }
    });

    beforeEach(() => {
        sorter = new TransactionGroupFeesSorter();
    });

    describe('sortGroupsByBurnedFees', () => {
        test('should sort transaction groups in descending order based on the total burned fees', async () => {
            // Given
            const groupA: Transaction<OPNetTransactionTypes>[] = [];
            const groupB: Transaction<OPNetTransactionTypes>[] = [];
            const groupC: Transaction<OPNetTransactionTypes>[] = [];

            groupA.push(await CreateFakeTransaction(networks.regtest, BigInt(20000000)));
            groupA.push(await CreateFakeTransaction(networks.regtest, BigInt(20000000)));
            groupB.push(await CreateFakeTransaction(networks.regtest, BigInt(30000000)));
            groupB.push(await CreateFakeTransaction(networks.regtest, BigInt(30000000)));
            groupC.push(await CreateFakeTransaction(networks.regtest, BigInt(10000000)));
            groupC.push(await CreateFakeTransaction(networks.regtest, BigInt(10000000)));

            const groups: Transaction<OPNetTransactionTypes>[][] = [groupA, groupB, groupC];

            // When
            const sortedGroups = sorter.sortGroupByFees(groups);

            // Then
            expect(sortedGroups[0]).toMatchObject(groupB);
            expect(sortedGroups[1]).toMatchObject(groupA);
            expect(sortedGroups[2]).toMatchObject(groupC);
        });

        test('should use hash comparison for sorting when burned fees are equal', async () => {
            // Given
            const groupA: Transaction<OPNetTransactionTypes>[] = [];
            const groupB: Transaction<OPNetTransactionTypes>[] = [];

            groupA.push(
                await CreateFakeTransaction(
                    networks.regtest,
                    BigInt(30000000),
                    null,
                    null,
                    null,
                    Buffer.from('Z'),
                ),
            );
            groupB.push(
                await CreateFakeTransaction(
                    networks.regtest,
                    BigInt(30000000),
                    null,
                    null,
                    null,
                    Buffer.from('A'),
                ),
            );

            const groups: Transaction<OPNetTransactionTypes>[][] = [groupA, groupB];

            // When
            const sortedGroups = sorter.sortGroupByFees(groups);

            // Then
            expect(sortedGroups[0]).toMatchObject(groupB);
            expect(sortedGroups[1]).toMatchObject(groupA);
        });

        test('should handle empty groups', async () => {
            // Given
            const groupA: Transaction<OPNetTransactionTypes>[] = [];
            const groupB: Transaction<OPNetTransactionTypes>[] = [];

            groupB.push(await CreateFakeTransaction(networks.regtest, BigInt(30000000)));
            const groups = [groupA, groupB];

            // When
            const sortedGroups = sorter.sortGroupByFees(groups);

            // Then
            expect(sortedGroups[0]).toBe(groupB);
            expect(sortedGroups[1]).toBe(groupA);
        });
    });
});
