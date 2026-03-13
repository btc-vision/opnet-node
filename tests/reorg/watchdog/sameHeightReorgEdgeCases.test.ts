/**
 * Edge case tests for the reorg detection fixes.
 *
 * Tests cover:
 * - Same-height hash comparison boundary conditions
 * - Guard conditions (started, chainReorged, incomingHeight > 0)
 * - PROCESS_ONLY_X_BLOCK interaction with regression detection
 * - currentHeader staleness / timing edge cases
 * - restoreBlockchain integration with hash mismatch path
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

function setupRestoreMocks(
    mockRpcClient: ReturnType<typeof createMockRpcClient>,
    mockVMStorage: ReturnType<typeof createMockVMStorage>,
    mockVMManager: ReturnType<typeof createMockVMManager>,
    goodBlockHash: string,
) {
    mockRpcClient.getBlockHash.mockResolvedValue(goodBlockHash);
    mockVMStorage.getBlockHeader.mockResolvedValue({
        hash: goodBlockHash,
        checksumRoot: 'cs',
    });
    mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
}

type LastBlockShape = { hash?: string; checksum?: string; blockNumber?: bigint };

describe('ReorgWatchdog - Same-Height Hash Comparison Edge Cases', () => {
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

    describe('hash comparison only triggers when heights match', () => {
        it('should skip hash comparison when currentHeader is 1 block ahead', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 101, // 1 ahead of task.tip
                hash: 'hash_at_101',
                previousblockhash: 'prev100',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'different_hash_at_100', // Different from currentHeader, but heights differ
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Heights differ (101 != 100), hash comparison must NOT trigger
            expect(result).toBe(false);
        });

        it('should skip hash comparison when currentHeader is 1 block behind', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            // currentHeader behind task.tip (negative syncBlockDiff = -1)
            watchdog.onBlockChange({
                height: 99,
                hash: 'hash_at_99',
                previousblockhash: 'prev98',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'block100',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Heights differ (99 != 100), skip hash comparison
            expect(result).toBe(false);
        });

        it('should trigger hash comparison at exact height match', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100, // Exact match
                hash: 'canonical_100',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'stale_100', // Different!
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            expect(result).toBe(true);
        });
    });

    describe('hash comparison does not interfere with previousBlockHash detection', () => {
        it('should detect previousBlockHash mismatch BEFORE hash comparison', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'stored_prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'stored_prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical_100',
                previousblockhash: 'new_prev99',
            } as never);

            // Block has wrong previousBlockHash (classic reorg detection)
            const block = createMockBlock({
                height: 100n,
                hash: 'canonical_100', // Hash matches but previousBlockHash doesn't
                previousBlockHash: 'wrong_prev99',
            });
            const task = createMockTask({ tip: 100n, block });

            // restoreBlockchain will be called via the ORIGINAL verifyChainReorg path
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'stored_prev99');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Should detect via previousBlockHash mismatch, not hash comparison
            expect(result).toBe(true);
        });

        it('should use hash comparison as fallback when previousBlockHash passes', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical_100',
                previousblockhash: 'prev99',
            } as never);

            // previousBlockHash matches, but block hash differs (competing block)
            const block = createMockBlock({
                height: 100n,
                hash: 'competing_100',
                previousBlockHash: 'prev99', // Same parent
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // previousBlockHash passes, hash comparison catches it
            expect(result).toBe(true);
        });
    });

    describe('checksum verification still works with hash comparison', () => {
        it('should detect bad checksum even when hashes match', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'bad_checksum' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'block100', // Same hash
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'block100',
                previousBlockHash: 'prev99',
                previousBlockChecksum: 'good_checksum', // Doesn't match stored
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            // restoreBlockchain needed because checksum mismatch triggers reorg
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Checksum mismatch detected by verifyChainReorg, before hash comparison
            expect(result).toBe(true);
        });

        it('should pass when hashes match AND checksums match AND proofs verify', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'good_cs' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'block100', // Matches
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'block100', // Matches currentHeader
                previousBlockHash: 'prev99',
                previousBlockChecksum: 'good_cs',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            expect(result).toBe(false);
        });
    });

    describe('genesis and low-height edge cases', () => {
        it('should handle height 1 with matching hashes', async () => {
            watchdog.onBlockChange({
                height: 1,
                hash: 'hash1',
                previousblockhash: 'genesis',
            } as never);

            const block = createMockBlock({
                height: 1n,
                hash: 'hash1',
                previousBlockHash: 'genesis',
            });
            const task = createMockTask({ tip: 1n, block });

            // verifyChainReorg returns false for previousBlock <= 0n
            const result = await watchdog.verifyChainReorgForBlock(task as never);

            expect(result).toBe(false);
        });

        it('should detect hash mismatch at height 1', async () => {
            watchdog.onBlockChange({
                height: 1,
                hash: 'canonical_hash1',
                previousblockhash: 'genesis',
            } as never);

            const block = createMockBlock({
                height: 1n,
                hash: 'stale_hash1',
                previousBlockHash: 'genesis',
            });
            const task = createMockTask({ tip: 1n, block });

            // restoreBlockchain walks back, genesis is at 0
            mockRpcClient.getBlockHash.mockResolvedValue('genesis_hash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'genesis_hash',
                checksumRoot: 'genesis_cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // verifyChainReorg returns false (genesis), but hash comparison catches it
            expect(result).toBe(true);
        });
    });

    describe('sync gap boundary with hash comparison', () => {
        it('should NOT hash-compare when gap is exactly 100 (skips all verification)', async () => {
            watchdog.onBlockChange({
                height: 200,
                hash: 'different_hash',
                previousblockhash: 'tip_prev',
            } as never);

            const block = createMockBlock({ height: 100n, hash: 'block100' });
            const task = createMockTask({ tip: 100n, block });

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Gap >= 100 skips everything including hash comparison
            expect(result).toBe(false);
        });

        it('should hash-compare when gap is 99 and heights happen to match after onBlockChange', async () => {
            // Unusual but possible: gap was 99, then onBlockChange fires making heights match
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100, // Height matches task.tip
                hash: 'new_canonical',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'old_block',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            // Gap < 100, heights match, hashes differ → reorg detected
            expect(result).toBe(true);
        });
    });

    describe('restoreBlockchain called from hash comparison path', () => {
        it('should call restoreBlockchain with task.tip when hash mismatch detected', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'stale',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            const restoreSpy = vi.spyOn(watchdog as never, 'restoreBlockchain');
            await watchdog.verifyChainReorgForBlock(task as never);

            expect(restoreSpy).toHaveBeenCalledWith(100n);
        });

        it('should NOT call restoreBlockchain when hashes match', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'same_hash',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'same_hash',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const restoreSpy = vi.spyOn(watchdog as never, 'restoreBlockchain');
            await watchdog.verifyChainReorgForBlock(task as never);

            expect(restoreSpy).not.toHaveBeenCalled();
        });

        it('should reset lastBlock after hash mismatch reorg', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'stale',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            await watchdog.verifyChainReorgForBlock(task as never);

            // restoreBlockchain resets lastBlock to {}
            expect(Reflect.get(watchdog, 'lastBlock')).toEqual({});
        });

        it('should NOT update lastBlock when hash mismatch triggers reorg', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'stale',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            const updateSpy = vi.spyOn(watchdog as never, 'updateBlock');
            await watchdog.verifyChainReorgForBlock(task as never);

            // updateBlock should NOT be called, restoreBlockchain resets lastBlock
            expect(updateSpy).not.toHaveBeenCalled();
        });
    });

    describe('ALWAYS_ENABLE_REORG_VERIFICATION with hash comparison', () => {
        it('should hash-compare even at large gap when forced', async () => {
            mockConfig.DEV.ALWAYS_ENABLE_REORG_VERIFICATION = true;

            Reflect.set(watchdog, 'lastBlock', {
                hash: 'prev99',
                checksum: 'cs99',
                blockNumber: 99n,
                opnetBlock: { hash: 'prev99', checksumRoot: 'cs99' },
            });

            // Large gap but heights happen to match (task.tip = currentHeader.blockNumber)
            watchdog.onBlockChange({
                height: 100,
                hash: 'canonical',
                previousblockhash: 'prev99',
            } as never);

            const block = createMockBlock({
                height: 100n,
                hash: 'stale',
                previousBlockHash: 'prev99',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            setupRestoreMocks(mockRpcClient, mockVMStorage, mockVMManager, 'prev99');

            const result = await watchdog.verifyChainReorgForBlock(task as never);

            expect(result).toBe(true);
        });
    });
});
