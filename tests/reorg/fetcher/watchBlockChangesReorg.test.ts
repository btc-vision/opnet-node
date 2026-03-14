/**
 * Tests for RPCBlockFetcher.watchBlockChanges hash-based change detection.
 *
 * Verifies that the RPC poller correctly detects block hash changes
 * (new blocks, same-height reorgs, height regressions) and notifies
 * subscribers. Also tests error recovery and isFirst behavior.
 */
import '../../reorg/setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPCBlockFetcher } from '../../../src/src/blockchain-indexer/fetcher/RPCBlockFetcher.js';

const mockConfig = vi.hoisted(() => ({
    INDEXER: { BLOCK_QUERY_INTERVAL: 100 },
    DEV: { CAUSE_FETCHING_FAILURE: false, ENABLE_REORG_NIGHTMARE: false },
}));
vi.mock('../../../src/src/config/Config.js', () => ({ Config: mockConfig }));

// Mock the ZERO_HASH import
vi.mock(
    '../../../src/src/blockchain-indexer/processor/block/types/ZeroValue.js',
    () => ({
        ZERO_HASH: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
);

vi.mock('@btc-vision/bsi-common', () => ({
    Logger: class Logger {
        readonly logColor: string = '';
        log(..._a: unknown[]) {}
        warn(..._a: unknown[]) {}
        error(..._a: unknown[]) {}
        info(..._a: unknown[]) {}
        debugBright(..._a: unknown[]) {}
        success(..._a: unknown[]) {}
        fail(..._a: unknown[]) {}
        panic(..._a: unknown[]) {}
        important(..._a: unknown[]) {}
    },
}));

function createMockRpc() {
    return {
        getBlockHeight: vi.fn(),
        getBlockHeader: vi.fn(),
        getBlockHash: vi.fn(),
        getBlockInfoWithTransactionData: vi.fn(),
        getBlockHashes: vi.fn(),
        getBlocksInfoWithTransactionData: vi.fn(),
        getRawTransactions: vi.fn(),
    };
}

describe('RPCBlockFetcher.watchBlockChanges - Reorg Detection', () => {
    let rpc: ReturnType<typeof createMockRpc>;
    let fetcher: RPCBlockFetcher;
    let subscriberCalls: Array<{ height: number; hash: string; previousblockhash: string }>;

    beforeEach(() => {
        vi.useFakeTimers();
        rpc = createMockRpc();
        subscriberCalls = [];

        fetcher = new RPCBlockFetcher({
            maximumPrefetchBlocks: 10,
            rpc: rpc as never,
        });

        fetcher.subscribeToBlockChanges((header) => {
            subscriberCalls.push({
                height: header.height,
                hash: header.hash,
                previousblockhash: header.previousblockhash,
            });
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('hash-based change detection', () => {
        it('should notify subscribers when block hash changes (normal new block)', async () => {
            rpc.getBlockHeight.mockResolvedValue({
                blockHeight: 100,
                blockHash: 'hash100',
            });
            rpc.getBlockHeader.mockResolvedValue({
                height: 100,
                hash: 'hash100',
                previousblockhash: 'hash99',
            });

            await fetcher.watchBlockChanges(true);

            expect(subscriberCalls).toHaveLength(1);
            expect(subscriberCalls[0].hash).toBe('hash100');
        });

        it('should notify on same-height different-hash (1-block reorg detected at RPC level)', async () => {
            // First poll: block 100 with hash A
            rpc.getBlockHeight.mockResolvedValueOnce({
                blockHeight: 100,
                blockHash: 'hashA',
            });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 100,
                hash: 'hashA',
                previousblockhash: 'hash99',
            });

            await fetcher.watchBlockChanges(true);
            expect(subscriberCalls).toHaveLength(1);
            expect(subscriberCalls[0].hash).toBe('hashA');

            // Second poll: still block 100 but different hash (reorg!)
            rpc.getBlockHeight.mockResolvedValueOnce({
                blockHeight: 100,
                blockHash: 'hashB',
            });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 100,
                hash: 'hashB',
                previousblockhash: 'hash99',
            });

            // Trigger the setTimeout callback
            await vi.advanceTimersByTimeAsync(mockConfig.INDEXER.BLOCK_QUERY_INTERVAL);

            expect(subscriberCalls).toHaveLength(2);
            expect(subscriberCalls[1].hash).toBe('hashB');
            expect(subscriberCalls[1].height).toBe(100); // Same height!
        });

        it('should NOT notify when same hash is seen again', async () => {
            rpc.getBlockHeight.mockResolvedValue({
                blockHeight: 100,
                blockHash: 'hash100',
            });
            rpc.getBlockHeader.mockResolvedValue({
                height: 100,
                hash: 'hash100',
                previousblockhash: 'hash99',
            });

            await fetcher.watchBlockChanges(true);
            expect(subscriberCalls).toHaveLength(1);

            // Second poll: same hash
            await vi.advanceTimersByTimeAsync(mockConfig.INDEXER.BLOCK_QUERY_INTERVAL);

            expect(subscriberCalls).toHaveLength(1); // No new notification
        });

        it('should detect height regression (tip goes backwards)', async () => {
            // First poll: height 101
            rpc.getBlockHeight.mockResolvedValueOnce({
                blockHeight: 101,
                blockHash: 'hash101',
            });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 101,
                hash: 'hash101',
                previousblockhash: 'hash100',
            });

            await fetcher.watchBlockChanges(true);
            expect(subscriberCalls).toHaveLength(1);
            expect(subscriberCalls[0].height).toBe(101);

            // Second poll: height dropped back to 100 (reorg!)
            rpc.getBlockHeight.mockResolvedValueOnce({
                blockHeight: 100,
                blockHash: 'new_hash100',
            });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 100,
                hash: 'new_hash100',
                previousblockhash: 'hash99',
            });

            await vi.advanceTimersByTimeAsync(mockConfig.INDEXER.BLOCK_QUERY_INTERVAL);

            // Should notify because hash changed
            expect(subscriberCalls).toHaveLength(2);
            expect(subscriberCalls[1].height).toBe(100);
        });
    });

    describe('rapid same-height hash changes', () => {
        it('should detect 3 consecutive competing blocks at the same height', async () => {
            // Block 100 hash A
            rpc.getBlockHeight.mockResolvedValueOnce({ blockHeight: 100, blockHash: 'hashA' });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 100, hash: 'hashA', previousblockhash: 'hash99',
            });
            await fetcher.watchBlockChanges(true);

            // Block 100 hash B (reorg #1)
            rpc.getBlockHeight.mockResolvedValueOnce({ blockHeight: 100, blockHash: 'hashB' });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 100, hash: 'hashB', previousblockhash: 'hash99',
            });
            await vi.advanceTimersByTimeAsync(mockConfig.INDEXER.BLOCK_QUERY_INTERVAL);

            // Block 100 hash C (reorg #2)
            rpc.getBlockHeight.mockResolvedValueOnce({ blockHeight: 100, blockHash: 'hashC' });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 100, hash: 'hashC', previousblockhash: 'hash99',
            });
            await vi.advanceTimersByTimeAsync(mockConfig.INDEXER.BLOCK_QUERY_INTERVAL);

            expect(subscriberCalls).toHaveLength(3);
            expect(subscriberCalls[0].hash).toBe('hashA');
            expect(subscriberCalls[1].hash).toBe('hashB');
            expect(subscriberCalls[2].hash).toBe('hashC');

            // All at same height
            expect(subscriberCalls.every((c) => c.height === 100)).toBe(true);
        });
    });

    describe('polling behavior', () => {
        it('should continue polling after error', async () => {
            rpc.getBlockHeight.mockRejectedValueOnce(new Error('RPC timeout'));

            // First call fails
            await fetcher.watchBlockChanges(false);
            expect(subscriberCalls).toHaveLength(0);

            // Should still schedule next poll
            rpc.getBlockHeight.mockResolvedValueOnce({
                blockHeight: 100,
                blockHash: 'hash100',
            });
            rpc.getBlockHeader.mockResolvedValueOnce({
                height: 100,
                hash: 'hash100',
                previousblockhash: 'hash99',
            });

            await vi.advanceTimersByTimeAsync(mockConfig.INDEXER.BLOCK_QUERY_INTERVAL);

            expect(subscriberCalls).toHaveLength(1);
        });

        it('should always notify on isFirst=true even with same hash', async () => {
            rpc.getBlockHeight.mockResolvedValue({
                blockHeight: 100,
                blockHash: 'hash100',
            });
            rpc.getBlockHeader.mockResolvedValue({
                height: 100,
                hash: 'hash100',
                previousblockhash: 'hash99',
            });

            await fetcher.watchBlockChanges(true);
            expect(subscriberCalls).toHaveLength(1);
        });
    });
});
