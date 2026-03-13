/**
 * Category 9: Reorg Detection (tests 481-530)
 *
 * Tests for verifyChainReorgForBlock, verifyChainReorg, getLastBlockHash,
 * onBlockChange, updateBlock, pendingBlockHeight, and subscribeToReorgs.
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

type LastBlockShape = { hash?: string; checksum?: string; blockNumber?: bigint };
type LastBlockHashResult = { hash?: string; checksum?: string; opnetBlock?: Record<string, unknown>; blockNumber?: bigint };
type CurrentHeaderShape = { blockNumber?: bigint; blockHash?: string; previousBlockHash?: string };

/** Helper to call private method verifyChainReorg via Reflect */
function callVerifyChainReorg(watchdog: ReorgWatchdog, block: Record<string, unknown>): Promise<boolean> {
    const method = Reflect.get(watchdog, 'verifyChainReorg') as (block: Record<string, unknown>) => Promise<boolean>;
    return Reflect.apply(method, watchdog, [block]);
}

/** Helper to call private method getLastBlockHash via Reflect */
function callGetLastBlockHash(watchdog: ReorgWatchdog, height: bigint): Promise<LastBlockHashResult | undefined> {
    const method = Reflect.get(watchdog, 'getLastBlockHash') as (height: bigint) => Promise<LastBlockHashResult | undefined>;
    return Reflect.apply(method, watchdog, [height]);
}

/** Helper to call private method updateBlock via Reflect */
function callUpdateBlock(watchdog: ReorgWatchdog, block: Record<string, unknown>): void {
    const method = Reflect.get(watchdog, 'updateBlock') as (block: Record<string, unknown>) => void;
    Reflect.apply(method, watchdog, [block]);
}

describe('ReorgWatchdog - Reorg Detection (Category 9)', () => {
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

    // ── Tests 481-488: verifyChainReorgForBlock sync gap skip ──

    describe('verifyChainReorgForBlock - sync gap skip', () => {
        it('test 481: should skip reorg verification when sync gap is exactly 100', async () => {
            watchdog.onBlockChange({
                height: 200,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const task = createMockTask({ tip: 100n });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).not.toHaveBeenCalled();
        });

        it('test 482: should skip reorg verification when sync gap is greater than 100', async () => {
            watchdog.onBlockChange({
                height: 500,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const task = createMockTask({ tip: 100n });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
        });

        it('test 483: should perform reorg verification when sync gap is 99', async () => {
            watchdog.onBlockChange({
                height: 199,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({ height: 100n, previousBlockHash: 'prevhash' });
            const task = createMockTask({ tip: 100n, block });
            // Make verifyChainReorg return false (no reorg)
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prevhash',
                checksumRoot: 'checksum',
            });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
        });

        it('test 484: should perform reorg verification when sync gap is 0', async () => {
            watchdog.onBlockChange({
                height: 100,
                hash: 'blockhash', // matches block.hash so same-height check passes
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({ height: 100n, previousBlockHash: 'prevhash' });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prevhash',
                checksumRoot: 'checksum',
            });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
        });

        it('test 485: should perform reorg verification when sync gap is 1', async () => {
            watchdog.onBlockChange({
                height: 101,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({ height: 100n, previousBlockHash: 'prevhash' });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prevhash',
                checksumRoot: 'checksum',
            });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
        });

        it('test 486: should force reorg verification when ALWAYS_ENABLE_REORG_VERIFICATION is true even with large gap', async () => {
            mockConfig.DEV.ALWAYS_ENABLE_REORG_VERIFICATION = true;
            watchdog.onBlockChange({
                height: 500,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({ height: 100n, previousBlockHash: 'prevhash' });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prevhash',
                checksumRoot: 'checksum',
            });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            // verifyChainReorg is called and should return false (no reorg) since hashes match
            expect(result).toBe(false);
        });

        it('test 487: should update lastBlock when sync gap causes skip', async () => {
            watchdog.onBlockChange({
                height: 300,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({ height: 100n, hash: 'myhash', checksumRoot: 'mycs' });
            const task = createMockTask({ tip: 100n, block });
            await watchdog.verifyChainReorgForBlock(task as never);
            const lastBlock = Reflect.get(watchdog, 'lastBlock') as LastBlockShape;
            expect(lastBlock.hash).toBe('myhash');
            expect(lastBlock.checksum).toBe('mycs');
            expect(lastBlock.blockNumber).toBe(100n);
        });

        it('test 488: should update lastBlock by calling getBlockHeaderDocument when skipping', async () => {
            watchdog.onBlockChange({
                height: 250,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({ height: 100n });
            const task = createMockTask({ tip: 100n, block });
            await watchdog.verifyChainReorgForBlock(task as never);
            expect(block.getBlockHeaderDocument).toHaveBeenCalled();
        });
    });

    // ── Tests 489-494: verifyChainReorgForBlock no reorg / reorg detected ──

    describe('verifyChainReorgForBlock - reorg result path', () => {
        it('test 489: should return false and update block when no reorg detected', async () => {
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'prevhash',
                hash: 'goodhash',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'prevhash',
                checksumRoot: 'checksum',
            });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(false);
            expect((Reflect.get(watchdog, 'lastBlock') as LastBlockShape).hash).toBe('goodhash');
        });

        it('test 490: should return true when reorg is detected (Bitcoin hash mismatch)', async () => {
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'wrongprevhash',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'correctprevhash',
                checksumRoot: 'checksum',
            });
            // restoreBlockchain will be called; set up mocks
            mockRpcClient.getBlockHash.mockResolvedValue('correctprevhash');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'correctprevhash',
                checksumRoot: 'checksum',
            });
            const result = await watchdog.verifyChainReorgForBlock(task as never);
            expect(result).toBe(true);
        });

        it('test 491: should call restoreBlockchain when reorg detected', async () => {
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'badprev',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'goodprev',
                checksumRoot: 'checksum',
            });
            // For restoreBlockchain -> revertToLastGoodBlock
            mockRpcClient.getBlockHash.mockResolvedValue('goodprev');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodprev',
                checksumRoot: 'checksum',
            });

            const restoreSpy = vi.spyOn(watchdog as never, 'restoreBlockchain');
            await watchdog.verifyChainReorgForBlock(task as never);
            expect(restoreSpy).toHaveBeenCalledWith(100n);
        });

        it('test 492: should not update lastBlock when reorg detected', async () => {
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'badprev',
                hash: 'shouldnotbeused',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'goodprev',
                checksumRoot: 'checksum',
            });
            mockRpcClient.getBlockHash.mockResolvedValue('goodprev');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodprev',
                checksumRoot: 'checksum',
            });
            await watchdog.verifyChainReorgForBlock(task as never);
            // restoreBlockchain resets lastBlock to {}
            expect((Reflect.get(watchdog, 'lastBlock') as LastBlockShape).hash).toBeUndefined();
        });

        it('test 493: should not call updateBlock when reorg detected', async () => {
            watchdog.onBlockChange({
                height: 105,
                hash: 'headhash',
                previousblockhash: 'headprev',
            } as never);
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'badprev',
            });
            const task = createMockTask({ tip: 100n, block });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'goodprev',
                checksumRoot: 'checksum',
            });
            mockRpcClient.getBlockHash.mockResolvedValue('goodprev');
            mockVMStorage.getBlockHeader.mockResolvedValue({
                hash: 'goodprev',
                checksumRoot: 'checksum',
            });

            const updateSpy = vi.spyOn(watchdog as never, 'updateBlock');
            await watchdog.verifyChainReorgForBlock(task as never);
            expect(updateSpy).not.toHaveBeenCalled();
        });

        it('test 494: should throw when currentHeader is not set', async () => {
            const task = createMockTask();
            await expect(watchdog.verifyChainReorgForBlock(task as never)).rejects.toThrow(
                'Current header is not set',
            );
        });
    });

    // ── Tests 495-503: verifyChainReorg Bitcoin and OPNet reorg detection ──

    describe('verifyChainReorg - Bitcoin and OPNet reorg detection', () => {
        it('test 495: should return true when Bitcoin previousBlockHash does not match', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'wronghash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'correcthash',
                checksumRoot: 'checksum',
            });
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });

        it('test 496: should return false when Bitcoin hash matches and proofs verify', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'checksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(false);
        });

        it('test 497: should return true when Bitcoin hash matches but proofs fail', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'checksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(false);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });

        it('test 498: should return true when previousBlockChecksum does not match', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
                previousBlockChecksum: 'badchecksum',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'goodchecksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });

        it('test 499: should return false when previousBlockChecksum matches and proofs verify', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
                previousBlockChecksum: 'goodchecksum',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'goodchecksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(false);
        });

        it('test 500: should return true when checksum matches but proofs fail', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
                previousBlockChecksum: 'goodchecksum',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'goodchecksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(false);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });

        it('test 501: should not check OPNet proofs when Bitcoin hash mismatch is detected', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'wronghash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'correcthash',
                checksumRoot: 'checksum',
            });
            await callVerifyChainReorg(watchdog, block);
            expect(mockVMManager.blockHeaderValidator.validateBlockChecksum).not.toHaveBeenCalled();
        });

        it('test 502: should throw when previous block header is not found', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'somehash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue(undefined);
            await expect(callVerifyChainReorg(watchdog, block)).rejects.toThrow(
                'Error fetching previous block hash',
            );
        });

        it('test 503: should use cached lastBlock when available for matching height', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'cachedhash',
                checksum: 'cachedchecksum',
                blockNumber: 99n,
                opnetBlock: { hash: 'cachedhash', checksumRoot: 'cachedchecksum' },
            });
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'cachedhash',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(false);
            // Should not have called getBlockHeader since cache was used
            expect(mockVMManager.blockHeaderValidator.getBlockHeader).not.toHaveBeenCalled();
        });
    });

    // ── Tests 504-505: genesis block handling ──

    describe('verifyChainReorg - genesis block handling', () => {
        it('test 504: should return false for block at height 1 (previousBlock = 0)', async () => {
            const block = createMockBlock({ height: 1n, previousBlockHash: 'genesis' });
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(false);
        });

        it('test 505: should return false for block at height 0 (previousBlock = -1)', async () => {
            const block = createMockBlock({ height: 0n, previousBlockHash: 'noprev' });
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(false);
        });
    });

    // ── Tests 506-510: getLastBlockHash behavior ──

    describe('getLastBlockHash', () => {
        it('test 506: should return undefined for height -1', async () => {
            const result = await callGetLastBlockHash(watchdog, -1n);
            expect(result).toBeUndefined();
        });

        it('test 507: should return cached lastBlock when height matches and hash/checksum present', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'cached',
                checksum: 'cachedcs',
                blockNumber: 50n,
                opnetBlock: { hash: 'cached', checksumRoot: 'cachedcs' },
            });
            const result = await callGetLastBlockHash(watchdog, 50n);
            expect(result).toEqual({
                hash: 'cached',
                checksum: 'cachedcs',
                opnetBlock: { hash: 'cached', checksumRoot: 'cachedcs' },
            });
        });

        it('test 508: should not return cache when blockNumber does not match', async () => {
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'cached',
                checksum: 'cachedcs',
                blockNumber: 50n,
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'fromdb',
                checksumRoot: 'fromdbcs',
            });
            const result = await callGetLastBlockHash(watchdog, 51n);
            expect(result?.hash).toBe('fromdb');
        });

        it('test 509: should fetch from blockHeaderValidator when not cached', async () => {
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'dbhash',
                checksumRoot: 'dbcs',
            });
            const result = await callGetLastBlockHash(watchdog, 42n);
            expect(mockVMManager.blockHeaderValidator.getBlockHeader).toHaveBeenCalledWith(42n);
            expect(result).toEqual({
                blockNumber: 42n,
                hash: 'dbhash',
                checksum: 'dbcs',
                opnetBlock: { hash: 'dbhash', checksumRoot: 'dbcs' },
            });
        });

        it('test 510: should throw when blockHeaderValidator returns undefined', async () => {
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue(undefined);
            await expect(callGetLastBlockHash(watchdog, 42n)).rejects.toThrow(
                'Error fetching previous block hash',
            );
        });
    });

    // ── Tests 511-514: checksum comparison logic ──

    describe('verifyChainReorg - checksum comparison logic', () => {
        it('test 511: should return false when no previousBlockChecksum and proofs pass', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
                previousBlockChecksum: undefined,
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'anychecksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(false);
        });

        it('test 512: should return true when no previousBlockChecksum and proofs fail', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
                previousBlockChecksum: undefined,
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'anychecksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(false);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });

        it('test 513: should return true when both checksum mismatch and proofs fail', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
                previousBlockChecksum: 'mismatch',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'different',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(false);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });

        it('test 514: should return true when checksum mismatches even if proofs pass', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
                previousBlockChecksum: 'wrongcs',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'correctcs',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockResolvedValue(true);
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });
    });

    // ── Tests 515-518: verifyChainReorg error handling ──

    describe('verifyChainReorg - error handling', () => {
        it('test 515: should return true when validateBlockChecksum throws', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'checksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockRejectedValue(
                new Error('validation failed'),
            );
            const result = await callVerifyChainReorg(watchdog, block);
            expect(result).toBe(true);
        });

        it('test 516: should catch validateBlockChecksum error and not throw outward', async () => {
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'matchhash',
            });
            mockVMManager.blockHeaderValidator.getBlockHeader.mockResolvedValue({
                hash: 'matchhash',
                checksumRoot: 'checksum',
            });
            mockVMManager.blockHeaderValidator.validateBlockChecksum.mockRejectedValue(
                new Error('boom'),
            );
            // Should not throw, but should return true
            await expect(callVerifyChainReorg(watchdog, block)).resolves.toBe(true);
        });

        it('test 517: should throw when getLastBlockHash returns no opnetBlock', async () => {
            // Set up lastBlock without opnetBlock
            Reflect.set(watchdog, 'lastBlock', {
                hash: 'cached',
                checksum: 'cachedcs',
                blockNumber: 99n,
                opnetBlock: undefined,
            });
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'somehash',
            });
            // getLastBlockHash returns object without opnetBlock, so verifyChainReorg throws
            await expect(callVerifyChainReorg(watchdog, block)).rejects.toThrow(
                'Error fetching previous block hash',
            );
        });

        it('test 518: should throw when getLastBlockHash throws (blockHeaderValidator fails)', async () => {
            mockVMManager.blockHeaderValidator.getBlockHeader.mockRejectedValue(
                new Error('DB error'),
            );
            const block = createMockBlock({
                height: 100n,
                previousBlockHash: 'somehash',
            });
            await expect(callVerifyChainReorg(watchdog, block)).rejects.toThrow('DB error');
        });
    });

    // ── Tests 519-530: onBlockChange, updateBlock, pendingBlockHeight, subscribeToReorgs ──

    describe('onBlockChange', () => {
        it('test 519: should set currentHeader from block header info', () => {
            watchdog.onBlockChange({
                height: 42,
                hash: 'blockhhash42',
                previousblockhash: 'blockhhash41',
            } as never);
            const header = Reflect.get(watchdog, '_currentHeader') as CurrentHeaderShape;
            expect(header).toEqual({
                blockNumber: 42n,
                blockHash: 'blockhhash42',
                previousBlockHash: 'blockhhash41',
            });
        });

        it('test 520: should convert height to bigint', () => {
            watchdog.onBlockChange({
                height: 999,
                hash: 'h999',
                previousblockhash: 'h998',
            } as never);
            expect((Reflect.get(watchdog, '_currentHeader') as CurrentHeaderShape).blockNumber).toBe(999n);
        });

        it('test 521: should overwrite previous header on subsequent calls', () => {
            watchdog.onBlockChange({
                height: 10,
                hash: 'h10',
                previousblockhash: 'h9',
            } as never);
            watchdog.onBlockChange({
                height: 20,
                hash: 'h20',
                previousblockhash: 'h19',
            } as never);
            const header = Reflect.get(watchdog, '_currentHeader') as CurrentHeaderShape;
            expect(header.blockNumber).toBe(20n);
            expect(header.blockHash).toBe('h20');
        });
    });

    describe('updateBlock', () => {
        it('test 522: should set lastBlock hash from block', () => {
            const block = createMockBlock({ hash: 'newhash' });
            callUpdateBlock(watchdog, block);
            expect((Reflect.get(watchdog, 'lastBlock') as LastBlockShape).hash).toBe('newhash');
        });

        it('test 523: should set lastBlock checksum from block checksumRoot', () => {
            const block = createMockBlock({ checksumRoot: 'newchecksum' });
            callUpdateBlock(watchdog, block);
            expect((Reflect.get(watchdog, 'lastBlock') as LastBlockShape).checksum).toBe('newchecksum');
        });

        it('test 524: should set lastBlock blockNumber from block height', () => {
            const block = createMockBlock({ height: 55n });
            callUpdateBlock(watchdog, block);
            expect((Reflect.get(watchdog, 'lastBlock') as LastBlockShape).blockNumber).toBe(55n);
        });

        it('test 525: should call getBlockHeaderDocument on the block', () => {
            const block = createMockBlock();
            callUpdateBlock(watchdog, block);
            expect(block.getBlockHeaderDocument).toHaveBeenCalled();
        });
    });

    describe('pendingBlockHeight', () => {
        it('test 526: should throw when lastBlock blockNumber is undefined', () => {
            Reflect.set(watchdog, 'lastBlock', {});
            expect(() => watchdog.pendingBlockHeight).toThrow('Last block number is not set');
        });

        it('test 527: should return the lastBlock blockNumber', () => {
            Reflect.set(watchdog, 'lastBlock', { blockNumber: 42n });
            expect(watchdog.pendingBlockHeight).toBe(42n);
        });

        it('test 528: should return -1n when initialized at genesis', () => {
            Reflect.set(watchdog, 'lastBlock', { blockNumber: -1n });
            expect(watchdog.pendingBlockHeight).toBe(-1n);
        });
    });

    describe('subscribeToReorgs', () => {
        it('test 529: should add callback to reorgListeners', () => {
            const cb = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(cb);
            expect(Reflect.get(watchdog, 'reorgListeners') as unknown[]).toContain(cb);
        });

        it('test 530: should allow multiple subscriptions', () => {
            const cb1 = vi.fn().mockResolvedValue(undefined);
            const cb2 = vi.fn().mockResolvedValue(undefined);
            const cb3 = vi.fn().mockResolvedValue(undefined);
            watchdog.subscribeToReorgs(cb1);
            watchdog.subscribeToReorgs(cb2);
            watchdog.subscribeToReorgs(cb3);
            expect(Reflect.get(watchdog, 'reorgListeners') as unknown[]).toHaveLength(3);
        });
    });
});
