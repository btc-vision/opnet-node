/**
 * Category 10: Revert to Last Good Block (tests 531-570)
 *
 * Tests for the private revertToLastGoodBlock method which has two phases:
 * 1. Bitcoin phase: walk backwards comparing hashes until a matching block is found
 * 2. OPNet phase: validate checksum proofs walking backwards until proofs pass
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

describe('ReorgWatchdog - revertToLastGoodBlock (Category 10)', () => {
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

    // ── Tests 531-538: Bitcoin phase hash matching ──

    describe('Bitcoin phase - hash matching', () => {
        it('test 531: should find matching block on first check (1 block back)', async () => {
            // height=10, first check at 9 => hash matches
            mockRpcClient.getBlockHash.mockResolvedValue('hash9');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hash9',
                checksumRoot: 'cs9',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(9n);
        });

        it('test 532: should check block hash via RPC for each block during walk-back', async () => {
            // height=10, block 9 is bad, block 8 is good
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpchash9') // block 9
                .mockResolvedValueOnce('rpchash8'); // block 8
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'badhash9', checksumRoot: 'cs9' }) // block 9 phase 1
                .mockResolvedValueOnce({ hash: 'rpchash8', checksumRoot: 'cs8' }) // block 8 phase 1
                .mockResolvedValueOnce({ hash: 'rpchash8', checksumRoot: 'cs8' }); // block 8 phase 2
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(8n);
        });

        it('test 533: should compare savedBlockHeader.hash with RPC block hash', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('rpchash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'rpchash',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(5n);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(4);
        });

        it('test 534: should decrement block number for each check in Bitcoin phase', async () => {
            // height=5: checks 4, 3, 2
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpch4')
                .mockResolvedValueOnce('rpch3')
                .mockResolvedValueOnce('rpch2');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'bad4', checksumRoot: 'cs4' }) // block 4 mismatch
                .mockResolvedValueOnce({ hash: 'bad3', checksumRoot: 'cs3' }) // block 3 mismatch
                .mockResolvedValueOnce({ hash: 'rpch2', checksumRoot: 'cs2' }) // block 2 match
                .mockResolvedValueOnce({ hash: 'rpch2', checksumRoot: 'cs2' }); // block 2 phase 2
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(5n);
            expect(result).toBe(2n);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledTimes(3);
        });

        it('test 535: should stop walking back when hash matches in Bitcoin phase', async () => {
            // height=10, block 9 matches immediately
            mockRpcClient.getBlockHash.mockResolvedValue('matchhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(10n);
            // Only called once for block 9
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledTimes(1);
        });

        it('test 536: should throw when RPC returns null for block hash', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue(null);
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'somehash',
                checksumRoot: 'cs',
            });

            await expect((watchdog as any).revertToLastGoodBlock(10n)).rejects.toThrow(
                'Error fetching block hash',
            );
        });

        it('test 537: should throw when vmStorage returns undefined for block header in phase 1', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('rpchash');
            mockVMStorage.getBlockHeader.mockResolvedValue(undefined);

            await expect((watchdog as any).revertToLastGoodBlock(10n)).rejects.toThrow(
                'Error fetching block header',
            );
        });

        it('test 538: should call Promise.safeAll with getBlockHash and getBlockHeader', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash5');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hash5',
                checksumRoot: 'cs5',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(6n);
            // Block 5 is checked: getBlockHash(5) and getBlockHeader(5n)
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(5);
            expect(mockVMStorage.getBlockHeader).toHaveBeenCalledWith(5n);
        });
    });

    // ── Tests 539-540: simple 1-block reorg ──

    describe('simple 1-block reorg', () => {
        it('test 539: should return height-1 when only the immediate predecessor is good', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodhash',
                checksumRoot: 'goodcs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(100n);
            expect(result).toBe(99n);
        });

        it('test 540: should validate checksum at the matching block in phase 2', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodhash',
                checksumRoot: 'goodcs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(100n);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).toHaveBeenCalledWith({
                hash: 'goodhash',
                checksumRoot: 'goodcs',
            });
        });
    });

    // ── Tests 541-543: deep reorg ──

    describe('deep reorg', () => {
        it('test 541: should walk back multiple blocks to find good block', async () => {
            // height=10: blocks 9,8,7 bad, block 6 good
            let callCount = 0;
            mockRpcClient.getBlockHash.mockImplementation(() => {
                callCount++;
                return Promise.resolve(`rpchash${10 - callCount}`);
            });
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'badsaved9', checksumRoot: 'cs9' })
                .mockResolvedValueOnce({ hash: 'badsaved8', checksumRoot: 'cs8' })
                .mockResolvedValueOnce({ hash: 'badsaved7', checksumRoot: 'cs7' })
                .mockResolvedValueOnce({ hash: 'rpchash6', checksumRoot: 'cs6' }) // match
                .mockResolvedValueOnce({ hash: 'rpchash6', checksumRoot: 'cs6' }); // phase 2
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(6n);
        });

        it('test 542: should check all blocks during walk-back (no short-circuit)', async () => {
            // height=5: blocks 4,3 bad, block 2 good
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpch4')
                .mockResolvedValueOnce('rpch3')
                .mockResolvedValueOnce('rpch2');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'bad4', checksumRoot: 'cs4' })
                .mockResolvedValueOnce({ hash: 'bad3', checksumRoot: 'cs3' })
                .mockResolvedValueOnce({ hash: 'rpch2', checksumRoot: 'cs2' })
                .mockResolvedValueOnce({ hash: 'rpch2', checksumRoot: 'cs2' }); // phase 2
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(5n);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledTimes(3);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(4);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(3);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(2);
        });

        it('test 543: should handle reorg all the way to block 1', async () => {
            // height=3: blocks 2,1 bad, block 0 good... wait, it decrements before checking
            // height=3: check 2 (bad), check 1 (bad), check 0 (good)
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpch2')
                .mockResolvedValueOnce('rpch1')
                .mockResolvedValueOnce('rpch0');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'bad2', checksumRoot: 'cs2' })
                .mockResolvedValueOnce({ hash: 'bad1', checksumRoot: 'cs1' })
                .mockResolvedValueOnce({ hash: 'rpch0', checksumRoot: 'cs0' })
                .mockResolvedValueOnce({ hash: 'rpch0', checksumRoot: 'cs0' }); // phase 2
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(3n);
            expect(result).toBe(0n);
        });
    });

    // ── Tests 544-546: all blocks bad (genesis reached) ──

    describe('all blocks bad - genesis reached', () => {
        it('test 544: should return 0n when all blocks are bad and genesis is reached', async () => {
            // height=2: check 1 (bad), then previousBlock becomes 0, check 0... but wait
            // if previousBlock goes below 0, return 0n
            // height=1: check 0 (bad), previousBlock becomes -1, which is < 0 => return 0n
            mockRpcClient.getBlockHash.mockResolvedValue('rpch0');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'badhash',
                checksumRoot: 'cs',
            });

            const result = await (watchdog as any).revertToLastGoodBlock(1n);
            // Checks block 0 (bad), previousBlock goes to -1, which is < 0 => return 0n
            expect(result).toBe(0n);
        });

        it('test 545: should return 0n when starting from height 0', async () => {
            // height=0: previousBlock = -1 which is < 0 => return 0n
            const result = await (watchdog as any).revertToLastGoodBlock(0n);
            expect(result).toBe(0n);
        });

        it('test 546: should not throw when reaching genesis during walk-back', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('rpch');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'always_bad',
                checksumRoot: 'cs',
            });

            await expect((watchdog as any).revertToLastGoodBlock(2n)).resolves.toBe(0n);
        });
    });

    // ── Tests 547-554: OPNet phase checksum validation ──

    describe('OPNet phase - checksum validation', () => {
        it('test 547: should validate checksums starting from the Bitcoin-matched block', async () => {
            // Phase 1: block 9 matches
            mockRpcClient.getBlockHash.mockResolvedValue('matchhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'csroot',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(10n);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).toHaveBeenCalledWith({
                hash: 'matchhash',
                checksumRoot: 'csroot',
            });
        });

        it('test 548: should walk back further when checksum validation fails in phase 2', async () => {
            // Phase 1: block 9 matches hash
            mockRpcClient.getBlockHash.mockResolvedValue('matchhash');
            // Phase 2: block 9 fails checksum, block 8 passes
            let phase2CallCount = 0;
            mockVMStorage.getBlockHeader.mockImplementation((height: bigint) => {
                if (height === 9n) {
                    return Promise.resolve({ hash: 'matchhash', checksumRoot: 'cs9' });
                }
                if (height === 8n) {
                    return Promise.resolve({ hash: 'hash8', checksumRoot: 'cs8' });
                }
                return Promise.resolve(undefined);
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockImplementation(
                (header: { checksumRoot: string }) => {
                    phase2CallCount++;
                    // First call (block 9): fail. Second call (block 8): pass.
                    return Promise.resolve(phase2CallCount > 1);
                },
            );

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(8n);
        });

        it('test 549: should stop when checksum proofs pass in phase 2', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodhash',
                checksumRoot: 'goodcs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(10n);
            // Should only validate once since it passes on first try
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).toHaveBeenCalledTimes(
                1,
            );
        });

        it('test 550: should break out of phase 2 when no OPNet headers found', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            // Phase 1: block 9 matches
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'goodhash', checksumRoot: 'cs9' }) // phase 1, block 9
                .mockResolvedValueOnce(undefined); // phase 2, block 9 - no headers
            // Since getBlockHeader returns undefined in phase 2, it should break

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(9n);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).not.toHaveBeenCalled();
        });

        it('test 551: should handle validateBlockChecksum throwing in phase 2', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            // Phase 1: block 9 matches, Phase 2: block 9 throws, block 8 passes
            mockVMStorage.getBlockHeader.mockImplementation((height: bigint) => {
                if (height === 9n) {
                    return Promise.resolve({ hash: 'goodhash', checksumRoot: 'cs9' });
                }
                if (height === 8n) {
                    return Promise.resolve({ hash: 'h8', checksumRoot: 'cs8' });
                }
                return Promise.resolve(undefined);
            });
            let validateCallCount = 0;
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockImplementation(() => {
                validateCallCount++;
                if (validateCallCount === 1) {
                    return Promise.reject(new Error('validation error'));
                }
                return Promise.resolve(true);
            });

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(8n);
        });

        it('test 552: should treat validateBlockChecksum exception as BAD in phase 2', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            mockVMStorage.getBlockHeader.mockImplementation((height: bigint) => {
                if (height === 9n) {
                    return Promise.resolve({ hash: 'goodhash', checksumRoot: 'cs9' });
                }
                if (height === 8n) {
                    return Promise.resolve({ hash: 'h8', checksumRoot: 'cs8' });
                }
                return Promise.resolve(undefined);
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum
                .mockRejectedValueOnce(new Error('crash'))
                .mockResolvedValueOnce(true);

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            // Block 9 throws (bad), block 8 passes (good)
            expect(result).toBe(8n);
        });

        it('test 553: should decrement previousBlock in phase 2 while loop', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            // Phase 1: block 4 matches at height=5
            // Phase 2: block 4 fails, block 3 fails, block 2 passes
            mockVMStorage.getBlockHeader.mockImplementation((height: bigint) => {
                return Promise.resolve({
                    hash: height === 4n ? 'goodhash' : `hash${height}`,
                    checksumRoot: `cs${height}`,
                });
            });
            let callIdx = 0;
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockImplementation(() => {
                callIdx++;
                // calls 1 (block 4) and 2 (block 3) fail, call 3 (block 2) passes
                return Promise.resolve(callIdx >= 3);
            });

            const result = await (watchdog as any).revertToLastGoodBlock(5n);
            expect(result).toBe(2n);
        });

        it('test 554: should stop phase 2 walk-back when reaching block 0', async () => {
            // Phase 1: block 1 matches at height=2
            mockRpcClient.getBlockHash.mockResolvedValueOnce('rpch1');
            mockVMStorage.getBlockHeader.mockImplementation((height: bigint) => {
                if (height === 1n) {
                    return Promise.resolve({ hash: 'rpch1', checksumRoot: 'cs1' });
                }
                if (height === 0n) {
                    return Promise.resolve({ hash: 'h0', checksumRoot: 'cs0' });
                }
                return Promise.resolve(undefined);
            });
            // Phase 2: block 1 fails, block 0 fails => while(previousBlock-- > 0) ends
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(false);

            const result = await (watchdog as any).revertToLastGoodBlock(2n);
            // previousBlock starts at 1, fails, decrements to 0, fails, decrements to -1
            // while(-1 > 0) is false, so loop ends. previousBlock is now -1 but...
            // Actually let's trace: previousBlock=1, check, fail, while(1-- > 0) => while(true), previousBlock=0
            // previousBlock=0, check, fail, while(0-- > 0) => while(false), previousBlock=-1
            // returns -1n. But that's the actual behavior per the code:
            // do { ... } while(previousBlock-- > 0)
            // After last iteration: previousBlock was 0, post-decrement check 0 > 0 is false, and previousBlock is now -1
            expect(result).toBe(-1n);
        });
    });

    // ── Tests 555-557: combined Bitcoin + OPNet phase ──

    describe('combined Bitcoin + OPNet phase', () => {
        it('test 555: should find Bitcoin-good block and then validate OPNet checksums', async () => {
            // Phase 1: block 8 matches at height=10 (blocks 9 bad)
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpch9')
                .mockResolvedValueOnce('rpch8');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'bad9', checksumRoot: 'cs9' }) // phase 1 block 9
                .mockResolvedValueOnce({ hash: 'rpch8', checksumRoot: 'cs8' }) // phase 1 block 8 (match)
                .mockResolvedValueOnce({ hash: 'rpch8', checksumRoot: 'cs8' }); // phase 2 block 8
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(8n);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).toHaveBeenCalledTimes(
                1,
            );
        });

        it('test 556: should walk back further in OPNet phase even after Bitcoin match', async () => {
            // Phase 1: block 8 matches. Phase 2: block 8 fails, block 7 passes
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpch9')
                .mockResolvedValueOnce('rpch8');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'bad9', checksumRoot: 'cs9' }) // phase 1 block 9
                .mockResolvedValueOnce({ hash: 'rpch8', checksumRoot: 'cs8' }) // phase 1 block 8 (match)
                .mockResolvedValueOnce({ hash: 'rpch8', checksumRoot: 'cs8' }) // phase 2 block 8
                .mockResolvedValueOnce({ hash: 'h7', checksumRoot: 'cs7' }); // phase 2 block 7
            mockVMManager.blockHeaderValidator.validateBlockChecksum
                .mockResolvedValueOnce(false) // block 8 fails
                .mockResolvedValueOnce(true); // block 7 passes

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(7n);
        });

        it('test 557: should return correct block when Bitcoin match is far back and OPNet passes immediately', async () => {
            // Phase 1: walk back 5 blocks. Phase 2: passes on first try
            mockRpcClient.getBlockHash
                .mockResolvedValueOnce('rpch19')
                .mockResolvedValueOnce('rpch18')
                .mockResolvedValueOnce('rpch17')
                .mockResolvedValueOnce('rpch16')
                .mockResolvedValueOnce('rpch15');
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'bad19', checksumRoot: 'cs' }) // block 19
                .mockResolvedValueOnce({ hash: 'bad18', checksumRoot: 'cs' }) // block 18
                .mockResolvedValueOnce({ hash: 'bad17', checksumRoot: 'cs' }) // block 17
                .mockResolvedValueOnce({ hash: 'bad16', checksumRoot: 'cs' }) // block 16
                .mockResolvedValueOnce({ hash: 'rpch15', checksumRoot: 'cs15' }) // block 15 match
                .mockResolvedValueOnce({ hash: 'rpch15', checksumRoot: 'cs15' }); // phase 2
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(20n);
            expect(result).toBe(15n);
        });
    });

    // ── Tests 558-559: RPC interaction ──

    describe('RPC interaction', () => {
        it('test 558: should call getBlockHash with Number-converted block height', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hash',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(1000n);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(999);
        });

        it('test 559: should call vmStorage.getBlockHeader with bigint height', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hash',
                checksumRoot: 'cs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(500n);
            expect(mockVMStorage.getBlockHeader).toHaveBeenCalledWith(499n);
        });
    });

    // ── Tests 560-570: return values, edge cases, logging ──

    describe('return values, edge cases, and logging', () => {
        it('test 560: should return the block number where both phases pass', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('goodhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodhash',
                checksumRoot: 'goodcs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(50n);
            expect(result).toBe(49n);
        });

        it('test 561: should return 0n for height=0 without calling any RPC or storage', async () => {
            const result = await (watchdog as any).revertToLastGoodBlock(0n);
            expect(result).toBe(0n);
            // previousBlock becomes -1 which is < 0, returns 0n before any RPC calls
            expect(mockRpcClient.getBlockHash).not.toHaveBeenCalled();
        });

        it('test 562: should return bigint type', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('h');
            mockVMStorage.getBlockHeader.mockResolvedValue({ hash: 'h', checksumRoot: 'c' });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(typeof result).toBe('bigint');
        });

        it('test 563: should handle height=1 correctly', async () => {
            // previousBlock starts at 0
            mockRpcClient.getBlockHash.mockResolvedValue('hash0');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'hash0',
                checksumRoot: 'cs0',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(1n);
            expect(result).toBe(0n);
        });

        it('test 564: should handle very large block heights', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('bighash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'bighash',
                checksumRoot: 'bigcs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            const result = await (watchdog as any).revertToLastGoodBlock(1000000n);
            expect(result).toBe(999999n);
        });

        it('test 565: should call RPC and storage in parallel via Promise.safeAll', async () => {
            // Verify both are called for the same block during phase 1
            mockRpcClient.getBlockHash.mockResolvedValue('h99');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'h99',
                checksumRoot: 'cs99',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);

            await (watchdog as any).revertToLastGoodBlock(100n);
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledWith(99);
            expect(mockVMStorage.getBlockHeader).toHaveBeenCalledWith(99n);
        });

        it('test 566: should propagate errors from getBlockHash', async () => {
            mockRpcClient.getBlockHash.mockRejectedValue(new Error('RPC down'));
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'some',
                checksumRoot: 'cs',
            });

            await expect((watchdog as any).revertToLastGoodBlock(10n)).rejects.toThrow('RPC down');
        });

        it('test 567: should propagate errors from vmStorage.getBlockHeader in phase 1', async () => {
            mockRpcClient.getBlockHash.mockResolvedValue('hash');
            mockVMStorage.getBlockHeader.mockRejectedValue(new Error('DB crashed'));

            await expect((watchdog as any).revertToLastGoodBlock(10n)).rejects.toThrow(
                'DB crashed',
            );
        });

        it('test 568: should correctly handle block where only OPNet phase fails repeatedly', async () => {
            // Phase 1: block 9 matches immediately
            // Phase 2: block 9, 8 fail, block 7 passes
            mockRpcClient.getBlockHash.mockResolvedValue('matchhash');
            mockVMStorage.getBlockHeader.mockImplementation((height: bigint) => {
                return Promise.resolve({
                    hash: height === 9n ? 'matchhash' : `hash${height}`,
                    checksumRoot: `cs${height}`,
                });
            });
            let phase2Calls = 0;
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockImplementation(() => {
                phase2Calls++;
                return Promise.resolve(phase2Calls >= 3);
            });

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            expect(result).toBe(7n);
        });

        it('test 569: phase 2 should not call RPC getBlockHash', async () => {
            // Phase 1: block 9 matches
            mockRpcClient.getBlockHash.mockResolvedValue('matchhash');
            mockVMStorage.getBlockHeader.mockImplementation((height: bigint) => {
                return Promise.resolve({
                    hash: height === 9n ? 'matchhash' : `hash${height}`,
                    checksumRoot: `cs${height}`,
                });
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum
                .mockResolvedValueOnce(false) // block 9 fails
                .mockResolvedValueOnce(true); // block 8 passes

            await (watchdog as any).revertToLastGoodBlock(10n);
            // getBlockHash should only be called once (phase 1)
            expect(mockRpcClient.getBlockHash).toHaveBeenCalledTimes(1);
        });

        it('test 570: should handle phase 2 where no headers exist at the matched block', async () => {
            // Phase 1: block 9 matches
            mockRpcClient.getBlockHash.mockResolvedValue('matchhash');
            // Phase 1 returns valid header, phase 2 returns undefined
            mockVMStorage.getBlockHeader
                .mockResolvedValueOnce({ hash: 'matchhash', checksumRoot: 'cs' }) // phase 1
                .mockResolvedValueOnce(undefined); // phase 2

            const result = await (watchdog as any).revertToLastGoodBlock(10n);
            // Should break out of phase 2 and return 9n
            expect(result).toBe(9n);
        });
    });
});
