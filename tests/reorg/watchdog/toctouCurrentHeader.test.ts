/**
 * TOCTOU (Time-Of-Check-Time-Of-Use) race on currentHeader.
 *
 * In verifyChainReorgForBlock:
 *  1. The task was created when currentHeader was at block N
 *  2. By the time verifyChainReorgForBlock runs, onBlockChange has been called
 *     with a new tip (N+5), updating currentHeader
 *  3. The sync gap check uses the NEW currentHeader (stale relative to task creation)
 *  4. The same-height hash mismatch check uses the NEW currentHeader
 *
 * This means:
 *  - A reorg could be missed: if the gap grew beyond 100, verification is skipped
 *  - Or a false same-height mismatch: if currentHeader advanced past the task tip
 *
 * Also tests: currentHeader being undefined/null when verifyChainReorgForBlock is called.
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

describe('TOCTOU race on currentHeader in verifyChainReorgForBlock', () => {
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

    /** Section 1: currentHeader undefined / null */

    describe('C-3a: currentHeader is undefined/null when verifyChainReorgForBlock is called', () => {
        it('should throw "Current header is not set" when _currentHeader is null', async () => {
            // _currentHeader starts as null (no onBlockChange called yet)
            const task = createMockTask({ tip: 100n });

            // verifyChainReorgForBlock throws immediately if called
            // before any onBlockChange (e.g. if watchdog is initialised but block
            // changes haven't fired yet, or if onBlockChange fires after the task
            // is queued but before verifyChainReorgForBlock runs)
            await expect(watchdog.verifyChainReorgForBlock(task as never)).rejects.toThrow(
                'Current header is not set',
            );
        });

        it('should throw when _currentHeader is explicitly set to null', async () => {
            // Force null even after initialization
            Reflect.set(watchdog, '_currentHeader', null);

            const task = createMockTask({ tip: 50n });

            await expect(watchdog.verifyChainReorgForBlock(task as never)).rejects.toThrow(
                'Current header is not set',
            );
        });

        it('should NOT throw if onBlockChange has been called before verifyChainReorgForBlock', async () => {
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'prev',
            } as never);

            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'cs',
            });

            const task = createMockTask({ tip: 100n, block });

            // Should NOT throw - currentHeader is set
            await expect(watchdog.verifyChainReorgForBlock(task as never)).resolves.toBeDefined();
        });
    });

    /** Section 2: TOCTOU - currentHeader changes between task creation and verification */

    describe('C-3b: currentHeader changes between task creation and verification time', () => {
        it('should CONFIRM: TOCTOU - verification uses CURRENT header at verification time, not task-creation time', async () => {
            // SCENARIO: Task was created when tip was at 100.
            // The task is for block 100.
            // By verification time, tip has advanced to 205.
            // syncBlockDiff = 205 - 100 = 105 ≥ 100 → verification is SKIPPED.
            // But when the task was created (tip=100), diff=0 → would have been verified.

            // Step 1: Set header at 100 when "task was created"
            watchdog.onBlockChange({
                height: 100,
                hash: 'tip_at_100',
                previousblockhash: 'prev99',
            } as never);

            // Step 2: By verification time, tip has advanced to 205
            watchdog.onBlockChange({
                height: 205,
                hash: 'tip_at_205',
                previousblockhash: 'prev204',
            } as never);

            // Block 100 has a REORGED hash (different from what's canonical)
            const block = createMockBlock({
                height: 100n,
                hash: 'stale_hash_for_100',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });

            // Verification is SKIPPED because syncBlockDiff=105 ≥ 100
            // Even though the block at height 100 is stale/reorged
            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Verification was skipped (gap ≥ 100) → returns false (no reorg detected)
            // even though the block IS stale,  this is the missed-reorg scenario
            expect(result).toBe(false);

            // CONFIRM: validateBlockChecksum was NOT called (verification skipped)
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).not.toHaveBeenCalled();
        });

        it('should CONFIRM: with ALWAYS_ENABLE_REORG_VERIFICATION=true, TOCTOU does not cause skipped verification', async () => {
            mockConfig.DEV.ALWAYS_ENABLE_REORG_VERIFICATION = true;

            // Same scenario as above but with forced verification
            watchdog.onBlockChange({
                height: 100,
                hash: 'tip_100',
                previousblockhash: 'prev99',
            } as never);
            watchdog.onBlockChange({
                height: 205,
                hash: 'tip_205',
                previousblockhash: 'prev204',
            } as never);

            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'prev99',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prev99',
                checksumRoot: 'cs',
            });
            const task = createMockTask({ tip: 100n, block });

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // ALWAYS_ENABLE forces verification → validateBlockChecksum IS called
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).toHaveBeenCalled();
            // No reorg (hashes match) → false
            expect(result).toBe(false);
        });

        it('should CONFIRM: TOCTOU causes same-height check with wrong header', async () => {
            // SCENARIO: Task for block 100 was created when currentHeader.blockNumber=100.
            // Between task creation and verification, a new block 101 arrives.
            // At verification time, currentHeader is at 101.
            // The same-height check: currentHeader.blockNumber (101) ≠ task.tip (100)
            // → same-height mismatch check is NOT triggered.
            // But when task was created (header=100), it WOULD have been triggered
            // if the hash was different.

            // Set header to 100 (task creation time)
            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical_100',
                previousblockhash: 'prev99',
            } as never);

            // Advance header to 101 (before verification runs)
            watchdog.onBlockChange({
                height: 101,
                hash: 'canonical_101',
                previousblockhash: 'canonical_100',
            } as never);

            // Block being processed: height=100, different hash from canonical_100
            // This IS a stale block (competing fork at height 100)
            const block = createMockBlock({
                height: 100n,
                hash: 'stale_100', // Different from canonical_100
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });

            // Set up so verifyChainReorg passes (no hash mismatch at prev block level)
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prev99',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            // Verification runs (gap=1 < 100), but same-height check
            // uses currentHeader.blockNumber=101 ≠ task.tip=100 → no mismatch check
            // The stale block at height 100 is processed without detecting the fork
            const result = await watchdog.verifyChainReorgForBlock(task as never);

            expect(result).toBe(false); // missed the stale-block scenario
            // Confirm: no restoreBlockchain was called
        });
    });

    /** Section 3: The exact threshold behavior */

    describe('C-3c: Verification threshold boundary at syncBlockDiff=100', () => {
        it('should skip verification when syncBlockDiff == 100', async () => {
            watchdog.onBlockChange({
                height: 200,
                hash: 'h200',
                previousblockhash: 'h199',
            } as never);
            // syncBlockDiff = 200 - 100 = 100 → skip
            const task = createMockTask({ tip: 100n });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).not.toHaveBeenCalled();
        });

        it('should perform verification when syncBlockDiff == 99', async () => {
            watchdog.onBlockChange({
                height: 199,
                hash: 'h199',
                previousblockhash: 'h198',
            } as never);
            // syncBlockDiff = 199 - 100 = 99 → verify

            const block = createMockBlock({ height: 100n, previousBlockHash: 'prev99' });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prev99',
                checksumRoot: 'cs',
            });

            await watchdog.verifyChainReorgForBlock(task as never);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).toHaveBeenCalled();
        });

        it('should skip verification when syncBlockDiff > 100', async () => {
            watchdog.onBlockChange({
                height: 500,
                hash: 'h500',
                previousblockhash: 'h499',
            } as never);
            // syncBlockDiff = 500 - 100 = 400 → skip
            const task = createMockTask({ tip: 100n });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).not.toHaveBeenCalled();
        });
    });

    /** Section 5: onBlockChange sets currentHeader atomically */

    describe('C-3e: onBlockChange updates currentHeader atomically', () => {
        it('should update all three fields of currentHeader in one call', () => {
            watchdog.onBlockChange({
                height: 42,
                hash: 'h42',
                previousblockhash: 'h41',
            } as never);

            const header = Reflect.get(watchdog, '_currentHeader') as {
                blockNumber: bigint;
                blockHash: string;
                previousBlockHash: string;
            };

            expect(header.blockNumber).toBe(42n);
            expect(header.blockHash).toBe('h42');
            expect(header.previousBlockHash).toBe('h41');
        });

        it('should completely replace previous currentHeader on each call', () => {
            watchdog.onBlockChange({
                height: 10,
                hash: 'old',
                previousblockhash: 'older',
            } as never);
            watchdog.onBlockChange({
                height: 20,
                hash: 'new',
                previousblockhash: 'newer',
            } as never);

            const header = Reflect.get(watchdog, '_currentHeader') as {
                blockNumber: bigint;
                blockHash: string;
                previousBlockHash: string;
            };

            // Only the latest values should be present
            expect(header.blockNumber).toBe(20n);
            expect(header.blockHash).toBe('new');
            expect(header.previousBlockHash).toBe('newer');
        });

        it('should handle rapid successive calls correctly', () => {
            for (let i = 0; i < 100; i++) {
                watchdog.onBlockChange({
                    height: i,
                    hash: `h${i}`,
                    previousblockhash: `h${i - 1}`,
                } as never);
            }

            const header = Reflect.get(watchdog, '_currentHeader') as { blockNumber: bigint };
            expect(header.blockNumber).toBe(99n);
        });
    });
});
