import 'jest';
import { networks } from 'bitcoinjs-lib';
import { OPNetTransactionTypes } from '../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionGroupFeesSorter } from '../../src/src/blockchain-indexer/processor/transaction/transaction-sorter/TransactionGroupFeesSorter.js';
import { Transaction } from '../../src/src/blockchain-indexer/processor/transaction/Transaction.js';
import { CreateFakeTransaction } from './TransactionCreatorHelper.js';

describe('TransactionGroupFeesSorter', () => {
    let sorter: TransactionGroupFeesSorter;

    beforeEach(() => {
        sorter = new TransactionGroupFeesSorter();
    });

    describe('sortGroupsByBurnedFees', () => {
        test('should sort transaction groups in descending order based on the total burned fees', () => {
            // Given
            const groupA: Transaction<OPNetTransactionTypes>[] = [];
            const groupB: Transaction<OPNetTransactionTypes>[] = [];
            const groupC: Transaction<OPNetTransactionTypes>[] = [];

            groupA.push(CreateFakeTransaction(networks.regtest, BigInt(20000000)));
            groupB.push(CreateFakeTransaction(networks.regtest, BigInt(30000000)));
            groupC.push(CreateFakeTransaction(networks.regtest, BigInt(10000000)));

            const groups: Transaction<OPNetTransactionTypes>[][] = [groupA, groupB, groupC];

            // When
            const sortedGroups = sorter.sortGroupsByBurnedFees(groups);

            // Then
            expect(sortedGroups[0]).toMatchObject(groupB);
            expect(sortedGroups[1]).toMatchObject(groupA);
            expect(sortedGroups[2]).toMatchObject(groupC);
        });

        test('should use hash comparison for sorting when burned fees are equal', () => {
            // Given
            const groupA: Transaction<OPNetTransactionTypes>[] = [];
            const groupB: Transaction<OPNetTransactionTypes>[] = [];

            groupA.push(
                CreateFakeTransaction(
                    networks.regtest,
                    BigInt(30000000),
                    null,
                    null,
                    null,
                    Buffer.from('Z'),
                ),
            );
            groupB.push(
                CreateFakeTransaction(
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
            const sortedGroups = sorter.sortGroupsByBurnedFees(groups);

            // Then
            expect(sortedGroups[0]).toMatchObject(groupB);
            expect(sortedGroups[1]).toMatchObject(groupA);
        });
    });
});
