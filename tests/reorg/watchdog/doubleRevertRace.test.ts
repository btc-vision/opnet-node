/**
 * Double-revert race between BlockIndexer height regression
 * and ReorgWatchdog hash mismatch.
 *
 * Both code paths can fire concurrently for the same block:
 *  - BlockIndexer.onBlockChange → onHeightRegressionDetected → revertChain
 *  - ReorgWatchdog.verifyChainReorgForBlock → restoreBlockchain → reorgListeners → revertChain
 *
 * The chainReorged flag in BlockIndexer blocks the HEIGHT REGRESSION path,
 * but the WATCHDOG path calls revertChain directly via the subscribed listener,
 * bypassing the chainReorged check entirely.
 *
 * Also tests: restoreBlockchain exception propagates uncaught from verifyChainReorgForBlock.
 */
import '../setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReorgWatchdog } from '../../../src/src/blockchain-indexer/processor/reorg/ReorgWatchdog.js';

const mockConfig = vi.hoisted(() => ({
    DEV: { ALWAYS_ENABLE_REORG_VERIFICATION: false },
}));
vi.mock('../../../src/src/config/Config.js', () => ({ Config: mockConfig }));

/** Factory helpers */

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
        getBlockHash: vi.fn().mockResolvedValue('goodhash'),
        getBlockHeader: vi.fn().mockResolvedValue({ previousblockhash: 'prevhash' }),
        getBlockCount: vi.fn().mockResolvedValue(1000),
    };
}

function createMockBlock(overrides: Record<string, unknown> = {}) {
    return {
        height: 100n,
        hash: 'blockhash',
        previousBlockHash: 'prevhash',
        checksumRoot: 'checksum',
        previousBlockChecksum: undefined as string | undefined,
        getBlockHeaderDocument: vi.fn().mockReturnValue({
            hash: 'blockhash',
            checksumRoot: 'checksum',
        }),
        ...overrides,
    };
}

function createMockTask(overrides: Record<string, unknown> = {}) {
    return {
        tip: 100n,
        block: createMockBlock(),
        ...overrides,
    };
}

/** Tests */

describe('Double-revert race condition', () => {
    let mockVMStorage: ReturnType<typeof createMockVMStorage>;
    let mockVMManager: ReturnType<typeof createMockVMManager>;
    let mockRpcClient: ReturnType<typeof createMockRpcClient>;
    let watchdog: ReorgWatchdog;

    beforeEach(() => {
        mockVMStorage = createMockVMStorage();
        mockVMManager = createMockVMManager();
        mockRpcClient = createMockRpcClient();
        mockConfig.DEV.ALWAYS_ENABLE_REORG_VERIFICATION = false;

        watchdog = new ReorgWatchdog(
            mockVMStorage as never,
            mockVMManager as never,
            mockRpcClient as never,
        );
    });

    /** Section 1: Watchdog can fire even while BlockIndexer is reverting */

    describe('C-2a: Watchdog revert path bypasses chainReorged flag', () => {
        it('should CONFIRM: watchdog reorgListeners are called independently of BlockIndexer.chainReorged', async () => {
            // The watchdog stores listeners and calls them directly.
            // There is NO check against BlockIndexer.chainReorged inside the watchdog.
            const reorgListener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(reorgListener);

            // Set up a scenario where restoreBlockchain is triggered
            // (bitcoin hash mismatch)
            watchdog.onBlockChange({
                height: 105,
                hash: 'canonical_hash',
                previousblockhash: 'headprev',
            } as never);

            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'WRONG_PREV_HASH',
                hash: 'block_hash_100',
            });
            const task = createMockTask({ tip: 100n, block });

            // Previous block has a DIFFERENT hash → triggers reorg
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'CORRECT_PREV_HASH', // different from block.previousBlockHash
                checksumRoot: 'cs',
            });
            // For restoreBlockchain → revertToLastGoodBlock
            mockRpcClient.getBlockHash.mockResolvedValue('CORRECT_PREV_HASH');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'CORRECT_PREV_HASH',
                checksumRoot: 'cs',
            });

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Listener was called without checking any chainReorged flag
            expect(result).toBe(true);
            expect(reorgListener).toHaveBeenCalledTimes(1);
        });

        it('should CONFIRM: two listeners can both be called for the same block (double-revert)', async () => {
            // Simulates BlockIndexer subscribing twice (once from registerEvents,
            // and once from onHeightMismatch path). In practice only one subscription
            // exists, but this demonstrates the lack of deduplication.
            const listener1 = vi.fn().mockResolvedValue(undefined);
            const listener2 = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener1);
            watchdog.subscribeToReorgs(listener2);

            watchdog.onBlockChange({
                height: 105,
                hash: 'canonical',
                previousblockhash: 'prev',
            } as never);

            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'WRONG',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'RIGHT',
                checksumRoot: 'cs',
            });
            mockRpcClient.getBlockHash.mockResolvedValue('RIGHT');
            mockVMStorage.getBlockHeader.mockResolvedValue({ hash: 'RIGHT', checksumRoot: 'cs' });

            const task = createMockTask({ tip: 100n, block });
            await watchdog.verifyChainReorgForBlock(task as never);

            // Both listeners fire → double revert
            expect(listener1).toHaveBeenCalledTimes(1);
            expect(listener2).toHaveBeenCalledTimes(1);
        });
    });

    /** Section 2: Same-height hash mismatch detection */

    describe('C-2b: Same-height hash mismatch branch in verifyChainReorgForBlock', () => {
        it('should detect same-height hash mismatch and call restoreBlockchain', async () => {
            // currentHeader.blockNumber == task.tip but hashes differ
            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical_hash',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'stale_hash', // Different from canonical
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });

            // Previous block matches → no chain-level reorg
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prev99',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            // restoreBlockchain setup
            mockRpcClient.getBlockHash.mockResolvedValue('prev99');
            mockVMStorage.getBlockHeader.mockResolvedValue({ hash: 'prev99', checksumRoot: 'cs' });

            const restoreSpy = vi.spyOn(
                watchdog as never as { restoreBlockchain: (tip: bigint) => Promise<void> },
                'restoreBlockchain',
            );

            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(true);
            expect(restoreSpy).toHaveBeenCalledWith(100n);
        });

        it('should NOT trigger same-height check when hashes match', async () => {
            watchdog.onBlockChange({
                height: 100,
                hash: 'same_hash',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'same_hash', // Matches canonical
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });

            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prev99',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const restoreSpy = vi.spyOn(
                watchdog as never as { restoreBlockchain: (tip: bigint) => Promise<void> },
                'restoreBlockchain',
            );

            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
            expect(restoreSpy).not.toHaveBeenCalled();
        });

        it('should NOT trigger same-height check when tip does not match currentHeader', async () => {
            // currentHeader at 105, task at 100 → different heights → no same-height check
            watchdog.onBlockChange({
                height: 105,
                hash: 'canonical_105',
                previousblockhash: 'prev104',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'block_100_hash',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });

            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prev99',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const restoreSpy = vi.spyOn(
                watchdog as never as { restoreBlockchain: (tip: bigint) => Promise<void> },
                'restoreBlockchain',
            );

            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
            expect(restoreSpy).not.toHaveBeenCalled();
        });
    });

    /** Section 3: restoreBlockchain exception propagates uncaught */

    describe('C-2c: restoreBlockchain exception propagates from verifyChainReorgForBlock', () => {
        it('should CONFIRM: exception from restoreBlockchain propagates out of verifyChainReorgForBlock', async () => {
            // verifyChainReorgForBlock has no try/catch
            // around the restoreBlockchain call site. If restoreBlockchain throws,
            // the exception propagates to the caller (IndexingTask.processBlock),
            // which then calls revertBlock,  potentially double-reverting.

            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);

            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'wrong_prev',
            });
            const task = createMockTask({ tip: 100n, block });

            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'correct_prev',
                checksumRoot: 'cs',
            });

            // Make restoreBlockchain throw by failing revertToLastGoodBlock
            mockRpcClient.getBlockHash.mockResolvedValue(null); // causes "Error fetching block hash"

            // This throws, and the caller has no try/catch for it
            await expect(watchdog.verifyChainReorgForBlock(task as never)).rejects.toThrow(
                'Error fetching block hash',
            );
        });

        it('should CONFIRM: exception from restoreBlockchain (vmStorage failure) propagates', async () => {
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'prev',
            } as never);

            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'wrong_prev',
            });
            const task = createMockTask({ tip: 100n, block });

            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'correct_prev',
                checksumRoot: 'cs',
            });

            // revertToLastGoodBlock: getBlockHash succeeds but getBlockHeader throws
            mockRpcClient.getBlockHash.mockResolvedValue('correct_prev');
            mockVMStorage.getBlockHeader.mockRejectedValue(new Error('DB connection lost'));

            await expect(watchdog.verifyChainReorgForBlock(task as never)).rejects.toThrow(
                'DB connection lost',
            );
        });

        it('should CONFIRM: same-height hash mismatch path also propagates restoreBlockchain exception', async () => {
            // Same-height mismatch triggers restoreBlockchain which throws
            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical',
                previousblockhash: 'prev',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'stale', // mismatch
                previousBlockHash: 'prev',
            });
            const task = createMockTask({ tip: 100n, block });

            // Previous block matches → no Bitcoin reorg, only same-height mismatch
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prev',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            // restoreBlockchain → revertToLastGoodBlock fails
            mockRpcClient.getBlockHash.mockResolvedValue(null);

            await expect(watchdog.verifyChainReorgForBlock(task as never)).rejects.toThrow(
                'Error fetching block hash',
            );
        });

        it('should CONFIRM: no try/catch in verifyChainReorgForBlock wraps restoreBlockchain', async () => {
            // If there WERE a try/catch, the function would return false instead of throwing.
            // The fact that it throws confirms there is no try/catch.
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'prev',
            } as never);

            const block = createMockBlock({ height: 100n, previousBlockHash: 'badprev' });
            const task = createMockTask({ tip: 100n, block });

            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'goodprev',
                checksumRoot: 'cs',
            });
            mockRpcClient.getBlockHash.mockRejectedValue(new Error('RPC unavailable'));

            // MUST throw,  not return false,  proving no try/catch
            await expect(watchdog.verifyChainReorgForBlock(task as never)).rejects.toThrow(
                'RPC unavailable',
            );
        });
    });

    /** Section 4: Listener propagation and sequencing */

    describe('C-2d: Listener sequencing and error propagation from notifyReorgListeners', () => {
        it('should propagate error from first listener (stops second listener from running)', async () => {
            const listener1 = vi.fn().mockRejectedValue(new Error('listener1 failed'));
            const listener2 = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener1);
            watchdog.subscribeToReorgs(listener2);

            // Set up reorg scenario
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodhash',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await expect(
                (
                    watchdog as never as { restoreBlockchain: (tip: bigint) => Promise<void> }
                ).restoreBlockchain(100n),
            ).rejects.toThrow('listener1 failed');

            // listener2 was never called because listener1 threw
            expect(listener2).not.toHaveBeenCalled();
        });

        it('should call listeners with correct revert coordinates', async () => {
            const listener = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(listener);

            // goodhash at height 99 → lastGoodBlock = 99
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash99');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodhash99',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (
                watchdog as never as { restoreBlockchain: (tip: bigint) => Promise<void> }
            ).restoreBlockchain(100n);

            // from = lastGoodBlock + 1 = 100, to = tip = 100
            expect(listener).toHaveBeenCalledWith(100n, 100n, 'goodhash99');
        });
    });
});
