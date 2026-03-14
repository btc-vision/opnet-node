/**
 * Tests for same-height reorg detection in ReorgWatchdog.
 * verifyChainReorgForBlock compares block.hash against
 * currentHeader.blockHash when heights match, catching 1-block
 * reorgs where competing blocks share the same parent.
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

function createMockBlock(overrides: Record<string, unknown> = {}) {
    return {
        height: 100n,
        hash: 'blockhash',
        previousBlockHash: 'prevhash',
        checksumRoot: 'checksum',
        previousBlockChecksum: undefined as string | undefined,
        getBlockHeaderDocument: vi.fn().mockReturnValue({
            hash: overrides.hash ?? 'blockhash',
            checksumRoot: overrides.checksumRoot ?? 'checksum',
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

/**
 * Helper to set up mocks so restoreBlockchain succeeds.
 * restoreBlockchain → revertToLastGoodBlock walks backwards comparing
 * rpc.getBlockHash(height) with vmStorage.getBlockHeader(height).hash.
 * We mock them to match at (goodBlockHeight) so the walk stops immediately.
 */
function setupRestoreMocks(
    mockRpcClient: ReturnType<typeof createMockRpcClient>,
    mockVMStorage: ReturnType<typeof createMockVMStorage>,
    mockVMManager: ReturnType<typeof createMockVMManager>,
    goodBlockHeight: bigint,
    goodBlockHash: string,
) {
    // revertToLastGoodBlock: rpc hash matches stored hash at goodBlockHeight
    mockRpcClient.getBlockHash.mockResolvedValue(goodBlockHash);
    mockVMStorage.getBlockHeader.mockResolvedValue({
        hash: goodBlockHash,
        checksumRoot: 'cs',
    });

    // validateBlockChecksum passes for the good block
    mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
}

describe('ReorgWatchdog - Same-Height Reorg Detection (CRITICAL)', () => {
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

    describe('same-height block hash comparison (competing blocks)', () => {
        it('should detect reorg when block hash differs from currentHeader at same height', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'parent99',
                checksum: 'checksum99',
                blockNumber: 99n,
                opnetBlock: { hash: 'parent99', checksumRoot: 'checksum99' },
            });

            // RPC tip is at height 100 with hash "blockB"
            watchdog.onBlockChange({
                height: 100,
                hash: 'blockB_hash',
                previousblockhash: 'parent99',
            } as never);

            // Node processing block A at height 100 (same parent, different hash)
            const blockA = createMockBlock({
                height: 100n,
                hash: 'blockA_hash',
                previousBlockHash: 'parent99',
            });

            const task = createMockTask({ tip: 100n, block: blockA });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            // Set up mocks so restoreBlockchain can walk back to block 99
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 99n, 'parent99');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // previousBlockHash matches (same parent), but block hash differs from RPC
            expect(result).toBe(true);
        });

        it('should NOT detect reorg when block hash matches currentHeader at same height', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'parent99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'parent99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'correct_hash',
                previousblockhash: 'parent99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'correct_hash', // Matches RPC
                previousBlockHash: 'parent99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
        });

        it('should not compare hashes when heights differ (task behind tip)', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            // RPC tip is at 105, but node is processing block 100
            watchdog.onBlockChange({
                height: 105,
                hash: 'tip_hash_at_105',
                previousblockhash: 'tip_prev',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'block100_hash', // Different from tip but that's expected
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Heights differ (105 != 100), so hash comparison should NOT trigger
            expect(result).toBe(false);
        });
    });

    describe('end-to-end: competing blocks at same height', () => {
        it('should detect competing block when miner A and B find blocks at same height', async () => {
            const minerABlock = createMockBlock({
                height: 100n,
                hash: 'miner_A_block_100',
                previousBlockHash: 'block_99_hash',
            });

            Reflect.set(watchdog, 'lastBlock', {
                hash: 'block_99_hash',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'block_99_hash', checksumRoot: 'cs99' },
            });

            // Bitcoin selected miner B's block
            watchdog.onBlockChange({
                height: 100,
                hash: 'miner_B_block_100',
                previousblockhash: 'block_99_hash',
            } as never);

            const task = createMockTask({ tip: 100n, block: minerABlock });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            // restoreBlockchain walks back to block 99
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 99n, 'block_99_hash');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Same parent, different hash → must be detected
            expect(result).toBe(true);
        });

        it('should NOT detect reorg when heights differ (caught at next block instead)', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'block99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'block99', checksumRoot: 'cs99' },
            });

            // RPC is now at height 101 (reorg + extension)
            // currentHeader height (101) != task.tip (100), so the hash
            // comparison won't trigger directly. But the node will process
            // block 100A, finalize it, then try block 101 which will fail
            // because its previousBlockHash points to 100B, not 100A.
            watchdog.onBlockChange({
                height: 101,
                hash: 'block101B',
                previousblockhash: 'block100B',
            } as never);

            const staleBlock = createMockBlock({
                height: 100n,
                hash: 'block100A',
                previousBlockHash: 'block99',
            });

            const task = createMockTask({ tip: 100n, block: staleBlock });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Heights differ (101 != 100), so same-height check doesn't apply.
            // The previousBlockHash check passes (block99 matches).
            // This specific case is caught when the NEXT block (101) is processed
            // and its previousBlockHash (block100B) doesn't match stored block100A.
            expect(result).toBe(false);
        });
    });
});
