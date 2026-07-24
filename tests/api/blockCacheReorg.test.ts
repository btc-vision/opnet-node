/**
 * Regression tests for "API cache returns stale data after reorg".
 *
 * Originally reported by Gachi 2026-05-19: after a reorg the node syncs
 * correctly, but the API keeps serving stale blocks. The fix lives in
 * `Route.onReorg()` (new virtual hook) + `Server.detectReorg()` /
 * `notifyAllRoutesOfReorg()` (reorg inference from tip sequence).
 *
 * Wire-up of the bug, for context:
 *
 *   1. The indexer reverts and re-applies blocks. It broadcasts a
 *      CHAIN_REORG message ONLY to ThreadTypes.SYNCHRONISATION
 *      (BlockIndexer.notifyThreadReorg, BlockIndexer.ts:496).
 *      The API thread does NOT receive that message.
 *
 *   2. The API thread learns about block-height changes through MongoDB
 *      polling on `BlockchainInformation.inProgressBlock`
 *      (BlockchainInfoRepository.startPolling, BlockchainInfoRepository.ts:174).
 *      That callback fans out to `route.onBlockChange(height, header)`
 *      for every route via Server.notifyAllRoutesOfBlockChange.
 *
 *   3. Before the fix, `BlockRoute.onBlockChange` only refreshed
 *      `currentBlockData`. It never touched `cachedBlocks`, so any block
 *      previously cached at height H was served stale post-reorg.
 *
 * The fix adds an `onReorg()` hook on every cache-holding route plus a
 * reorg detector in `Server` that compares each new tip against the
 * previously observed tip (height regression, same-height hash swap, or
 * broken hash chain on a single forward step).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
        DEV_MODE: false,
        DEBUG_LEVEL: 0,
        API: {
            MAXIMUM_PARALLEL_BLOCK_QUERY: 100,
            EPOCH_CACHE_SIZE: 100,
        },
        BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 },
    },
}));

vi.mock('../../src/src/config/network/NetworkConverter.js', () => ({
    NetworkConverter: { getNetwork: vi.fn(() => ({})) },
}));

vi.mock('@btc-vision/bsi-common', () => ({
    Logger: class Logger {
        readonly logColor: string = '';
        log() {}
        warn() {}
        error() {}
        info() {}
        debugBright() {}
        success() {}
        fail() {}
        panic() {}
        important() {}
    },
    DebugLevel: { INFO: 0, TRACE: 0 },
    DataConverter: { fromDecimal128: vi.fn() },
}));

vi.mock('@btc-vision/bitcoin', () => ({
    networks: { regtest: {} },
}));

vi.mock('../../src/src/api/data-converter/TransactionConverterForAPI.js', () => ({
    TransactionConverterForAPI: {
        convertTransactionToAPI: vi.fn((tx: unknown) => tx),
    },
}));

vi.mock('../../src/src/api/routes/api/v1/shared/DeploymentTxEncoder.js', () => ({
    DeploymentTxEncoder: class {
        async addDeploymentData<T>(tx: T): Promise<T> {
            return tx;
        }
    },
}));

import { BlockRoute } from '../../src/src/api/routes/api/v1/block/BlockRoute.js';
import { LatestBlock } from '../../src/src/api/routes/api/v1/block/LatestBlock.js';
import { Routes } from '../../src/src/api/enums/Routes.js';
import type { BlockHeaderAPIBlockDocument } from '../../src/src/db/interfaces/IBlockHeaderBlockDocument.js';
import type { BlockHeaderAPIDocumentWithTransactions } from '../../src/src/db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import type { BlockByIdParams } from '../../src/src/api/json-rpc/types/interfaces/params/blocks/BlockByIdParams.js';
import type { BlockByIdResult } from '../../src/src/api/json-rpc/types/interfaces/results/blocks/BlockByIdResult.js';

function makeHeader(height: number, hash: string): BlockHeaderAPIBlockDocument {
    return {
        height: String(height),
        hash,
        checksumRoot: `checksum-${hash}`,
        previousBlockHash: `parent-${hash}`,
        previousBlockChecksum: `parent-checksum-${hash}`,
        bits: '0',
        nonce: 0,
        version: 0,
        size: 0,
        txCount: 0,
        weight: 0,
        strippedSize: 0,
        merkleRoot: '',
        storageRoot: '',
        receiptRoot: '',
        checksumProofs: [],
        time: 0,
        medianTime: 0,
        ema: '0',
        baseGas: '0',
        gasUsed: '0',
    };
}

/**
 * Minimal concrete BlockRoute used only to exercise the protected cache
 * path. We do not implement onRequest because we drive `getCachedBlockData`
 * directly.
 */
class TestBlockRoute extends BlockRoute<Routes.BLOCK_BY_ID> {
    public constructor() {
        super(Routes.BLOCK_BY_ID);
    }

    public async getData(
        _params: BlockByIdParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined> {
        throw new Error('not used');
    }

    public async getDataRPC(_params: BlockByIdParams): Promise<BlockByIdResult | undefined> {
        throw new Error('not used');
    }

    public override async getCachedBlockData(
        includeTransactions: boolean,
        height: bigint,
    ): Promise<BlockHeaderAPIDocumentWithTransactions> {
        return super['getCachedBlockData'](includeTransactions, height);
    }

    public bindStorage(storage: unknown): void {
        // Storage is `protected`; set it directly through the field on the base.
        (this as unknown as { storage: unknown }).storage = storage;
    }
}

interface MockStorage {
    getBlockTransactions: ReturnType<typeof vi.fn>;
}

function makeStorage(headerForHeight: (h: bigint) => BlockHeaderAPIBlockDocument): MockStorage {
    return {
        getBlockTransactions: vi.fn(async (height: bigint) => ({
            block: headerForHeight(height),
            transactions: [],
            deployments: [],
        })),
    };
}

describe('BlockRoute cache staleness after reorg (regression)', () => {
    let route: TestBlockRoute;
    let activeHash = 'block-A';

    beforeEach(() => {
        route = new TestBlockRoute();
        activeHash = 'block-A';

        const storage = makeStorage((h: bigint) => makeHeader(Number(h), activeHash));
        route.bindStorage(storage);
    });

    it('onBlockChange alone does NOT invalidate cachedBlocks (documents the original bug)', async () => {
        // 1. Client fetches block 100 — caches "block-A".
        const beforeReorg = await route.getCachedBlockData(false, 100n);
        expect(beforeReorg.hash).toBe('block-A');

        // 2. The chain reorgs at height 100. The new canonical block at
        //    100 is "block-B". onBlockChange fires for the new tip.
        activeHash = 'block-B';
        route.onBlockChange(101n, makeHeader(101, 'block-B-tip'));

        // 3. Without the new onReorg() invalidation, the cache still
        //    serves "block-A". This test pins down that onBlockChange is
        //    deliberately not responsible for reorg invalidation — that's
        //    onReorg()'s job, exercised below and at the Server level.
        const afterReorg = await route.getCachedBlockData(false, 100n);
        expect(afterReorg.hash).toBe('block-A');
    });

    it('onReorg() clears cachedBlocks so a re-fetch returns the new canonical block', async () => {
        await route.getCachedBlockData(false, 100n);

        // Reorg replaces the block at height 100. The API thread's reorg
        // detector should call route.onReorg() before route.onBlockChange.
        activeHash = 'block-B';
        route.onReorg();
        route.onBlockChange(100n, makeHeader(100, 'block-B'));

        const afterReorg = await route.getCachedBlockData(false, 100n);
        expect(afterReorg.hash).toBe('block-B');
    });

    it('onReorg() wipes the entire height-keyed cache', async () => {
        await route.getCachedBlockData(false, 50n);
        await route.getCachedBlockData(false, 51n);
        await route.getCachedBlockData(false, 52n);

        activeHash = 'block-B';
        route.onReorg();

        // Re-fetch every height — none should return the pre-reorg hash.
        for (const h of [50n, 51n, 52n] as const) {
            const refetched = await route.getCachedBlockData(false, h);
            expect(refetched.hash).toBe('block-B');
        }
    });
});

describe('LatestBlock onBlockChange (control case)', () => {
    it('does refresh its single-slot cache when onBlockChange fires', async () => {
        const latest = new LatestBlock();

        // Seed the latest-block cache with height 100.
        latest.onBlockChange(100n, makeHeader(100, 'tip-A'));
        const first = await (
            latest as unknown as { getBlockHeader: () => Promise<string | undefined> }
        ).getBlockHeader();
        expect(first).toBe('0x64'); // 100 in hex

        // After a reorg the new tip is height 100 but on a different chain.
        // For LatestBlock the cached value is keyed by height only, so it
        // updates as soon as onBlockChange fires.
        latest.onBlockChange(99n, makeHeader(99, 'tip-B'));
        const second = await (
            latest as unknown as { getBlockHeader: () => Promise<string | undefined> }
        ).getBlockHeader();
        expect(second).toBe('0x63'); // 99 in hex
    });
});
