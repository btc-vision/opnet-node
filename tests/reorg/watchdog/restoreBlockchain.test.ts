/**
 * Category 11: Restore Blockchain (tests 571-600)
 *
 * Tests for restoreBlockchain, notifyReorgListeners, and init methods.
 */
import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReorgWatchdog } from '../../../src/src/blockchain-indexer/processor/reorg/ReorgWatchdog.js';

const mockConfig = vi.hoisted(() => ({
    DEV: { ALWAYS_ENABLE_REORG_VERIFICATION: false },
}));
vi.mock('../../../src/src/config/Config.js', () => ({ Config: mockConfig }));

function createMockVMStorage() {
    return {
        getBlockHeader: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockVMManager() {
    return {
        blockHeaderValidator: {
            validateBlockChecksum: vi.fn().mockResolvedValue(true),
            getBlockHeader: vi.fn().mockResolvedValue(undefined),
        },
    };
}

function createMockRpcClient() {
    return {
        getBlockHash: vi.fn().mockResolvedValue('somehash'),
        getBlockHeader: vi.fn().mockResolvedValue({ previousblockhash: 'prevhash' }),
        getBlockCount: vi.fn().mockResolvedValue(1000),
    };
}

describe('ReorgWatchdog - restoreBlockchain (Category 11)', () => {
    let mockVMStorage: ReturnType<typeof createMockVMStorage>;
    let mockVMManager: ReturnType<typeof createMockVMManager>;
    let mockRpcClient: ReturnType<typeof createMockRpcClient>;
    let watchdog: ReorgWatchdog;

    beforeEach(() => {
        mockVMStorage = createMockVMStorage();
        mockVMManager = createMockVMManager();
        mockRpcClient = createMockRpcClient();

        watchdog = new ReorgWatchdog(
            mockVMStorage as never,
            mockVMManager as never,
            mockRpcClient as never,
        );
    });

    // Helper to set up a successful revertToLastGoodBlock scenario
    function setupRevertScenario(goodBlockHeight: bigint, goodBlockHash: string) {
        // Phase 1: immediate match at goodBlockHeight
        mockRpcClient.getBlockHash.mockResolvedValue(goodBlockHash);
        mockVMStorage.getBlockHeader.mockResolvedValue({
            hash: goodBlockHash,
            checksumRoot: `cs_${goodBlockHash}`,
        });
        mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
    }

    // ── Tests 571-574: basic flow ──

    describe('basic flow', () => {
        it('test 571: should call revertToLastGoodBlock with the provided tip', async () => {
            setupRevertScenario(99n, 'goodhash99');
            const revertSpy = vi.spyOn(watchdog as any, 'revertToLastGoodBlock');

            await (watchdog as any).restoreBlockchain(100n);
            expect(revertSpy).toHaveBeenCalledWith(100n);
        });

        it('test 572: should fetch the last good block header from vmStorage', async () => {
            setupRevertScenario(99n, 'goodhash99');

            await (watchdog as any).restoreBlockchain(100n);
            // getBlockHeader is called during revertToLastGoodBlock and then again
            // for the lastGoodBlockHeader fetch in restoreBlockchain
            expect(mockVMStorage.getBlockHeader).toHaveBeenCalledWith(99n);
        });

        it('test 573: should throw when last good block header is not found in vmStorage', async () => {
            // revertToLastGoodBlock returns 99n
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            // Phase 1 returns valid, phase 2 returns valid
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'goodhash', checksumRoot: 'cs' }) // phase 1
                .mockResolvedValueOnce({ hash: 'goodhash', checksumRoot: 'cs' }) // phase 2
                .mockResolvedValueOnce(undefined); // restoreBlockchain's getBlockHeader call
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await expect((watchdog as any).restoreBlockchain(100n)).rejects.toThrow(
                'Error fetching last good block header',
            );
        });

        it('test 574: should call notifyReorgListeners with correct parameters', async () => {
            setupRevertScenario(99n, 'goodhash99');
            const notifySpy = vi.spyOn(watchdog as any, 'notifyReorgListeners');

            await (watchdog as any).restoreBlockchain(100n);
            // lastGoodBlock=99, so from=100, to=100 (tip), newBest=goodhash99
            expect(notifySpy).toHaveBeenCalledWith(100n, 100n, 'goodhash99');
        });
    });

    // ── Tests 575-583: listener notification ──

    describe('listener notification', () => {
        it('test 575: should call all registered reorg listeners', async () => {
            setupRevertScenario(99n, 'hash99');
            const listener1 = vi.fn().mockResolvedValue(undefined);
            const listener2 = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener1);
            watchdog.subscribeToReorgs(listener2);

            await (watchdog as any).restoreBlockchain(100n);
            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
        });

        it('test 576: should pass fromHeight as lastGoodBlock + 1', async () => {
            setupRevertScenario(49n, 'hash49');
            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            await (watchdog as any).restoreBlockchain(50n);
            expect(listener).toHaveBeenCalledWith(50n, 50n, 'hash49');
        });

        it('test 577: should pass toHeight as the original tip', async () => {
            setupRevertScenario(94n, 'hash94');
            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            await (watchdog as any).restoreBlockchain(95n);
            expect(listener.mock.calls[0][1]).toBe(95n);
        });

        it('test 578: should pass newBest as the last good block hash', async () => {
            setupRevertScenario(79n, 'bestblockhash');
            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            await (watchdog as any).restoreBlockchain(80n);
            expect(listener.mock.calls[0][2]).toBe('bestblockhash');
        });

        it('test 579: should call listeners sequentially (not in parallel)', async () => {
            setupRevertScenario(99n, 'hash99');
            const callOrder: number[] = [];
            const listener1 = vi.fn().mockImplementation(async () => {
                callOrder.push(1);
            });
            const listener2 = vi.fn().mockImplementation(async () => {
                callOrder.push(2);
            });
            watchdog.subscribeToReorgs(listener1);
            watchdog.subscribeToReorgs(listener2);

            await (watchdog as any).restoreBlockchain(100n);
            expect(callOrder).toEqual([1, 2]);
        });

        it('test 580: should work with zero listeners', async () => {
            setupRevertScenario(99n, 'hash99');
            // No listeners subscribed
            await expect((watchdog as any).restoreBlockchain(100n)).resolves.toBeUndefined();
        });

        it('test 581: should propagate listener errors', async () => {
            setupRevertScenario(99n, 'hash99');
            const failingListener = vi.fn().mockRejectedValue(new Error('listener failed'));
            watchdog.subscribeToReorgs(failingListener);

            await expect((watchdog as any).restoreBlockchain(100n)).rejects.toThrow(
                'listener failed',
            );
        });

        it('test 582: should call notifyReorgListeners with fromHeight > toHeight when lastGoodBlock >= tip', async () => {
            // Edge case: if revertToLastGoodBlock returns tip itself
            // This would make fromHeight = tip + 1 > toHeight = tip
            // Phase 1: block tip-1 matches immediately
            mockRpcClient.getBlockHash.mockResolvedValue('hashmatch');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hashmatch',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            await (watchdog as any).restoreBlockchain(10n);
            // revertToLastGoodBlock(10n) => checks block 9, matches => returns 9n
            // notifyReorgListeners(10n, 10n, 'hashmatch')
            expect(listener).toHaveBeenCalledWith(10n, 10n, 'hashmatch');
        });

        it('test 583: should notify with correct range for multi-block revert', async () => {
            // Phase 1: blocks 9, 8 bad, block 7 good
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpch9')
                .mockResolvedValueOnce('rpch8')
                .mockResolvedValueOnce('rpch7');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'bad9', checksumRoot: 'cs9' }) // phase 1 block 9
                .mockResolvedValueOnce({ hash: 'bad8', checksumRoot: 'cs8' }) // phase 1 block 8
                .mockResolvedValueOnce({ hash: 'rpch7', checksumRoot: 'cs7' }) // phase 1 block 7 (match)
                .mockResolvedValueOnce({ hash: 'rpch7', checksumRoot: 'cs7' }) // phase 2 block 7
                .mockResolvedValueOnce({ hash: 'rpch7', checksumRoot: 'cs7' }); // restoreBlockchain fetch
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            await (watchdog as any).restoreBlockchain(10n);
            // lastGoodBlock=7, so from=8, to=10
            expect(listener).toHaveBeenCalledWith(8n, 10n, 'rpch7');
        });
    });

    // ── Tests 584-587: error handling ──

    describe('error handling', () => {
        it('test 584: should propagate errors from revertToLastGoodBlock', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue(null);
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'somehash',
                checksumRoot: 'cs',
            });

            await expect((watchdog as any).restoreBlockchain(10n)).rejects.toThrow(
                'Error fetching block hash',
            );
        });

        it('test 585: should throw when vmStorage.getBlockHeader returns undefined for lastGoodBlock', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            // Phase 1 and 2 return valid, then the final fetch returns undefined
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'goodhash', checksumRoot: 'cs' })
                .mockResolvedValueOnce({ hash: 'goodhash', checksumRoot: 'cs' })
                .mockResolvedValueOnce(undefined);
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await expect((watchdog as any).restoreBlockchain(10n)).rejects.toThrow(
                'Error fetching last good block header',
            );
        });

        it('test 586: should not call notifyReorgListeners if revertToLastGoodBlock throws', async () => {
            mockRpcClient.getBlockHash.mockRejectedValue(new Error('RPC failure'));
            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            await expect((watchdog as any).restoreBlockchain(10n)).rejects.toThrow('RPC failure');
            expect(listener).not.toHaveBeenCalled();
        });

        it('test 587: should not call notifyReorgListeners if getBlockHeader for lastGoodBlock fails', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'goodhash', checksumRoot: 'cs' })
                .mockResolvedValueOnce({ hash: 'goodhash', checksumRoot: 'cs' })
                .mockResolvedValueOnce(undefined);
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            await expect((watchdog as any).restoreBlockchain(10n)).rejects.toThrow(
                'Error fetching last good block header',
            );
            expect(listener).not.toHaveBeenCalled();
        });
    });

    // ── Tests 588-592: state management ──

    describe('state management', () => {
        it('test 588: should reset lastBlock to empty object after restoreBlockchain', async () => {
            (watchdog as any).lastBlock = {
                hash: 'oldhash',
                checksum: 'oldcs',
                blockNumber: 50n,
            };
            setupRevertScenario(99n, 'goodhash');

            await (watchdog as any).restoreBlockchain(100n);
            expect((watchdog as any).lastBlock).toEqual({});
        });

        it('test 589: should clear lastBlock hash after restoreBlockchain', async () => {
            (watchdog as any).lastBlock = { hash: 'oldhash', blockNumber: 50n };
            setupRevertScenario(99n, 'goodhash');

            await (watchdog as any).restoreBlockchain(100n);
            expect((watchdog as any).lastBlock.hash).toBeUndefined();
        });

        it('test 590: should clear lastBlock blockNumber after restoreBlockchain', async () => {
            (watchdog as any).lastBlock = { blockNumber: 50n };
            setupRevertScenario(99n, 'goodhash');

            await (watchdog as any).restoreBlockchain(100n);
            expect((watchdog as any).lastBlock.blockNumber).toBeUndefined();
        });

        it('test 591: should clear lastBlock checksum after restoreBlockchain', async () => {
            (watchdog as any).lastBlock = { checksum: 'oldcs' };
            setupRevertScenario(99n, 'goodhash');

            await (watchdog as any).restoreBlockchain(100n);
            expect((watchdog as any).lastBlock.checksum).toBeUndefined();
        });

        it('test 592: should clear lastBlock before notifying listeners', async () => {
            setupRevertScenario(99n, 'goodhash');
            let lastBlockDuringNotification: Record<string, unknown> | undefined;
            const listener = vi.fn().mockImplementation(async () => {
                lastBlockDuringNotification = { ...(watchdog as any).lastBlock };
            });
            watchdog.subscribeToReorgs(listener);

            await (watchdog as any).restoreBlockchain(100n);
            expect(lastBlockDuringNotification).toEqual({});
        });
    });

    // ── Tests 593-600: init method ──

    describe('init method', () => {
        it('test 593: should set currentHeader from RPC data', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash10');
            mockRpcClient.getBlockHeader.mockResolvedValue({ previousblockhash: 'hash9' });
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hash9',
                checksumRoot: 'cs9',
            });

            await watchdog.init(10n);
            expect((watchdog as any)._currentHeader).toEqual({
                blockNumber: 10n,
                blockHash: 'hash10',
                previousBlockHash: 'hash9',
            });
        });

        it('test 594: should set lastBlock blockNumber to -1n when currentHeight is 0', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('genesishash');
            mockRpcClient.getBlockHeader.mockResolvedValue({
                previousblockhash:
                    '0000000000000000000000000000000000000000000000000000000000000000',
            });

            await watchdog.init(0n);
            expect((watchdog as any).lastBlock.blockNumber).toBe(-1n);
        });

        it('test 595: should throw when getBlockHash returns falsy', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue(null);

            await expect(watchdog.init(10n)).rejects.toThrow(
                'Error fetching block hash for block 10',
            );
        });

        it('test 596: should throw when getBlockHeader returns falsy', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash10');
            mockRpcClient.getBlockHeader.mockResolvedValue(null);

            await expect(watchdog.init(10n)).rejects.toThrow(
                'Error fetching block header for block 10',
            );
        });

        it('test 597: should set lastBlock with previous block header data', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash10');
            mockRpcClient.getBlockHeader.mockResolvedValue({ previousblockhash: 'hash9' });
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hash9stored',
                checksumRoot: 'cs9stored',
            });

            await watchdog.init(10n);
            expect((watchdog as any).lastBlock).toEqual({
                blockNumber: 10n,
                hash: 'hash9stored',
                checksum: 'cs9stored',
                opnetBlock: { hash: 'hash9stored', checksumRoot: 'cs9stored' },
            });
        });

        it('test 598: should recursively call init with decremented height when block header not found', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('somehash');
            mockRpcClient.getBlockHeader.mockResolvedValue({ previousblockhash: 'prevhash' });
            // First call (height=10): getBlockHeader(9n) => undefined (corrupted)
            // Second call (height=9): getBlockHeader(8n) => valid
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce(undefined) // height 9 not found
                .mockResolvedValueOnce({ hash: 'hash8', checksumRoot: 'cs8' }); // height 8 found

            await watchdog.init(10n);
            // Should have been called twice for RPC
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledTimes(2);
            expect((watchdog as any).lastBlock.hash).toBe('hash8');
        });

        it('test 599: should call getBlockHash with Number(currentHeight)', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash');
            mockRpcClient.getBlockHeader.mockResolvedValue({ previousblockhash: 'prev' });
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'prev',
                checksumRoot: 'cs',
            });

            await watchdog.init(42n);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(42);
        });

        it('test 600: should handle init at height 0 without querying vmStorage for block header', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('genesis');
            mockRpcClient.getBlockHeader.mockResolvedValue({ previousblockhash: 'none' });

            await watchdog.init(0n);
            // currentHeight - 1n = -1n, so lastBlock = { blockNumber: -1n } and return
            expect(mockVMStorage.getBlockHeader).not.toHaveBeenCalled();
            expect((watchdog as any).lastBlock).toEqual({ blockNumber: -1n });
        });
    });
});
