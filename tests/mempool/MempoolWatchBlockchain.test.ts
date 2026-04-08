/**
 * Tests for the H-03 fix in Mempool.watchBlockchain.
 *
 * Audit findings addressed:
 *
 * H-03: The original code computed `fullSync` from a tautological diff,
 *       since `onBlockChange` synchronously updates OPNetConsensus to the new
 *       blockHeight, `blockHeight - OPNetConsensus.getBlockHeight()` is always
 *       0n in the if-branch. The check was structurally meaningless and set
 *       `fullSync = true` whenever the indexer advanced its own frontier,
 *       regardless of whether the node had actually caught up to the Bitcoin
 *       chain tip.
 *
 *       The fix:
 *         - removes the tautological diff check,
 *         - compares blockHeight against Bitcoin Core's tip directly (with a
 *           1-block tolerance, mirroring verifyBlockHeight's >= 2 gap rule),
 *         - tracks `latestObservedHeight` so out-of-order async callbacks
 *           (BlockchainInfoRepository's polling loop fires listeners without
 *           awaiting them) cannot clobber `fullSync` with stale data,
 *         - re-checks the latest height after every await point.
 */

import '../utils/mockConfig.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mempool } from '../../src/src/poc/mempool/manager/Mempool.js';

/* ------------------------------------------------------------------------- */
/*                              Module mocks                                  */
/* ------------------------------------------------------------------------- */

const mockOPNetConsensus = vi.hoisted(() => ({
    consensusHeight: -1n,
    getBlockHeight: vi.fn(() => mockOPNetConsensus.consensusHeight),
    setBlockHeight: vi.fn((h: bigint) => {
        mockOPNetConsensus.consensusHeight = h;
    }),
}));

vi.mock('@btc-vision/bsi-common', () => ({
    Logger: class Logger {
        public readonly logColor: string = '';
        public log(..._a: unknown[]) {}
        public warn(..._a: unknown[]) {}
        public error(..._a: unknown[]) {}
        public info(..._a: unknown[]) {}
        public debugBright(..._a: unknown[]) {}
        public success(..._a: unknown[]) {}
        public fail(..._a: unknown[]) {}
        public panic(..._a: unknown[]) {}
        public important(..._a: unknown[]) {}
    },
    ConfigurableDBManager: vi.fn(function (this: Record<string, unknown>) {
        this.db = null;
        this.setup = vi.fn();
        this.connect = vi.fn().mockResolvedValue(undefined);
    }),
    DebugLevel: { TRACE: 5, WARN: 1, INFO: 2, DEBUG: 3, NONE: 0 },
}));

vi.mock('@btc-vision/bitcoin-rpc', () => ({
    BitcoinRPC: vi.fn(function (this: Record<string, unknown>) {
        this.init = vi.fn().mockResolvedValue(undefined);
        this.getBlockHeight = vi.fn();
    }),
    FeeEstimation: { CONSERVATIVE: 'CONSERVATIVE' },
}));

vi.mock('../../src/src/poc/mempool/transaction/TransactionVerifierManager.js', () => ({
    TransactionVerifierManager: vi.fn(function (this: Record<string, unknown>) {
        this.onBlockChange = vi.fn().mockResolvedValue(undefined);
        this.createRepositories = vi.fn().mockResolvedValue(undefined);
    }),
}));

vi.mock('../../src/src/db/repositories/MempoolRepository.js', () => ({
    MempoolRepository: vi.fn(function (this: Record<string, unknown>) {}),
}));

vi.mock('../../src/src/db/repositories/BlockchainInfoRepository.js', () => ({
    BlockchainInfoRepository: vi.fn(function (this: Record<string, unknown>) {
        this.watchBlockChanges = vi.fn();
        this.getCurrentBlockAndTriggerListeners = vi.fn().mockResolvedValue(undefined);
    }),
}));

vi.mock('../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: mockOPNetConsensus,
}));

vi.mock('../../src/src/poc/mempool/data-validator/TransactionSizeValidator.js', () => ({
    TransactionSizeValidator: vi.fn(function (this: Record<string, unknown>) {}),
}));

vi.mock('../../src/src/config/network/NetworkConverter.js', async () => {
    const { networks } = await import('@btc-vision/bitcoin');
    return {
        NetworkConverter: {
            getNetwork: vi.fn(() => networks.regtest),
        },
    };
});

vi.mock('../../src/src/vm/storage/databases/MongoUtils.js', () => ({
    getMongodbMajorVersion: vi.fn().mockResolvedValue(7),
}));

vi.mock('../../src/src/vm/storage/databases/MongoDBConfigurationDefaults.js', () => ({
    MongoDBConfigurationDefaults: {},
}));

/* ------------------------------------------------------------------------- */
/*                              Test helpers                                  */
/* ------------------------------------------------------------------------- */

interface PrivateMempoolState {
    fullSync: boolean;
    latestObservedHeight: bigint;
    bitcoinRPC: { getBlockHeight: ReturnType<typeof vi.fn> };
    onBlockChange: ReturnType<typeof vi.fn>;
}

function asPrivate(m: Mempool): PrivateMempoolState {
    return m as unknown as PrivateMempoolState;
}

interface WatcherHarness {
    mempool: Mempool;
    rpcSpy: ReturnType<typeof vi.fn>;
    onBlockChangeSpy: ReturnType<typeof vi.fn>;
    triggerCallback: (blockHeight: bigint) => Promise<void>;
}

/**
 * Constructs a Mempool instance, swaps in mocks for the dependencies that
 * watchBlockchain reads (`bitcoinRPC`, `blockchainInformationRepository`,
 * `onBlockChange`), runs `watchBlockchain()` to register the watcher
 * callback, and returns a harness for triggering the callback in tests.
 *
 * The instance-level Object.defineProperty calls shadow the prototype-level
 * private getter for `blockchainInformationRepository`, so we don't need to
 * call `init()` (which would require a real MongoDB connection).
 */
async function makeWatcherHarness(): Promise<WatcherHarness> {
    const mempool = new Mempool();

    const rpcSpy = vi.fn();
    const onBlockChangeSpy = vi.fn().mockResolvedValue(undefined);

    let capturedCb: ((h: bigint) => void | Promise<void>) | null = null;
    const fakeRepo = {
        watchBlockChanges: (cb: (h: bigint) => void | Promise<void>) => {
            capturedCb = cb;
        },
        getCurrentBlockAndTriggerListeners: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(mempool, 'bitcoinRPC', {
        value: { getBlockHeight: rpcSpy },
        writable: true,
        configurable: true,
    });

    Object.defineProperty(mempool, 'blockchainInformationRepository', {
        get: () => fakeRepo,
        configurable: true,
    });

    Object.defineProperty(mempool, 'onBlockChange', {
        value: onBlockChangeSpy,
        writable: true,
        configurable: true,
    });

    // Reset the shared OPNetConsensus mock to a known state.
    mockOPNetConsensus.consensusHeight = -1n;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (mempool as any).watchBlockchain();

    if (!capturedCb) {
        throw new Error('watchBlockchain did not register a callback');
    }

    return {
        mempool,
        rpcSpy,
        onBlockChangeSpy,
        triggerCallback: async (h: bigint) => {
            await capturedCb!(h);
        },
    };
}

async function flushMicrotasks(times: number = 4): Promise<void> {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

/* ------------------------------------------------------------------------- */
/*                                  Tests                                    */
/* ------------------------------------------------------------------------- */

describe('Mempool.watchBlockchain (H-03)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /* --------------------------- Basic behavior --------------------------- */

    describe('basic fullSync behavior', () => {
        it('sets fullSync=true when caught up to the Bitcoin tip', async () => {
            const h = await makeWatcherHarness();
            // Bitcoin RPC returns blockHeight=99 (so tip = 99 + 1 = 100).
            h.rpcSpy.mockResolvedValue({ blockHeight: 99 });

            await h.triggerCallback(100n);

            expect(asPrivate(h.mempool).fullSync).toBe(true);
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(100n);
        });

        it('sets fullSync=true within the 1-block tolerance', async () => {
            // Bitcoin tip is 1 block ahead (mining race / propagation delay).
            // We should still consider ourselves caught up.
            const h = await makeWatcherHarness();
            h.rpcSpy.mockResolvedValue({ blockHeight: 100 }); // tip = 101

            await h.triggerCallback(100n);

            expect(asPrivate(h.mempool).fullSync).toBe(true);
        });

        it('sets fullSync=false when behind by 2 or more blocks', async () => {
            const h = await makeWatcherHarness();
            // Pre-set fullSync to true to verify it gets overwritten.
            asPrivate(h.mempool).fullSync = true;
            h.rpcSpy.mockResolvedValue({ blockHeight: 102 }); // tip = 103

            await h.triggerCallback(100n);

            expect(asPrivate(h.mempool).fullSync).toBe(false);
        });

        it('does not invent a fullSync=true when fetching deeply historical blocks', async () => {
            // The H-03 audit framing: during initial sync, the watcher
            // observes the indexer's frontier (which is ahead of nothing).
            // Without the fix, fullSync would be set to true on every block.
            // With the fix, it's only true once we're at Bitcoin Core's tip.
            const h = await makeWatcherHarness();
            h.rpcSpy.mockResolvedValue({ blockHeight: 1_000_000 }); // tip far ahead

            await h.triggerCallback(50n);
            expect(asPrivate(h.mempool).fullSync).toBe(false);

            await h.triggerCallback(100n);
            expect(asPrivate(h.mempool).fullSync).toBe(false);

            await h.triggerCallback(50_000n);
            expect(asPrivate(h.mempool).fullSync).toBe(false);
        });
    });

    /* ------------------------ onBlockChange invocation -------------------- */

    describe('onBlockChange dispatching', () => {
        it('calls onBlockChange when consensus is behind or equal', async () => {
            const h = await makeWatcherHarness();
            mockOPNetConsensus.consensusHeight = 99n;
            h.rpcSpy.mockResolvedValue({ blockHeight: 99 });

            await h.triggerCallback(100n);

            expect(h.onBlockChangeSpy).toHaveBeenCalledTimes(1);
            expect(h.onBlockChangeSpy).toHaveBeenCalledWith(100n);
        });

        it('skips onBlockChange when consensus is already ahead', async () => {
            const h = await makeWatcherHarness();
            // Consensus is at 105; the watcher reports a stale 100.
            mockOPNetConsensus.consensusHeight = 105n;
            h.rpcSpy.mockResolvedValue({ blockHeight: 99 });

            await h.triggerCallback(100n);

            expect(h.onBlockChangeSpy).not.toHaveBeenCalled();
            // Latest observed should still be tracked (so any concurrent
            // callbacks that arrive later can correctly be flagged stale).
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(100n);
        });
    });

    /* ----------------------- Staleness / out-of-order --------------------- */

    describe('out-of-order callback staleness', () => {
        it('abandons a stale callback when a newer height arrives mid-onBlockChange', async () => {
            const h = await makeWatcherHarness();
            h.rpcSpy.mockResolvedValue({ blockHeight: 99 }); // tip = 100

            // First call's onBlockChange hangs until we resolve it.
            let resolve100!: () => void;
            const pending100 = new Promise<void>((r) => {
                resolve100 = r;
            });
            h.onBlockChangeSpy.mockImplementationOnce(() => pending100);
            h.onBlockChangeSpy.mockImplementationOnce(() => Promise.resolve());

            // Kick off callback A (height=100). It'll suspend in onBlockChange.
            const cbA = h.triggerCallback(100n);
            await flushMicrotasks();

            // Now fire callback B (height=101). This advances latestObservedHeight.
            const cbB = h.triggerCallback(101n);
            await flushMicrotasks();

            expect(asPrivate(h.mempool).latestObservedHeight).toBe(101n);

            // Release A's onBlockChange. A should observe latest=101 and bail
            // BEFORE touching fullSync (it would otherwise compute against
            // height=100 and possibly clobber B's correct answer).
            resolve100();

            await cbA;
            await cbB;

            // Final latest is 101, fullSync was set by B (which compared
            // height=101 against tip=100, so 101 >= 99 → true).
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(101n);
            expect(asPrivate(h.mempool).fullSync).toBe(true);
        });

        it('abandons a stale callback when a newer height arrives mid-RPC call', async () => {
            const h = await makeWatcherHarness();

            // RPC for callback A hangs.
            let resolveRpcA!: (v: { blockHeight: number }) => void;
            const pendingRpcA = new Promise<{ blockHeight: number }>((r) => {
                resolveRpcA = r;
            });
            h.rpcSpy.mockImplementationOnce(() => pendingRpcA);
            // RPC for callback B returns immediately with tip=200 (way ahead).
            h.rpcSpy.mockImplementationOnce(() => Promise.resolve({ blockHeight: 199 }));

            // Pre-state: assume we were already at fullSync=true.
            asPrivate(h.mempool).fullSync = true;

            const cbA = h.triggerCallback(100n);
            await flushMicrotasks();

            const cbB = h.triggerCallback(101n);
            await flushMicrotasks();

            // A's RPC returns LAST. Without the post-await staleness check,
            // A would compute fullSync from its (now stale) blockHeight=100.
            resolveRpcA({ blockHeight: 99 }); // tip 100, A would set true

            await cbA;
            await cbB;

            // B's check: blockHeight=101 vs tip=200. 101 >= 199 is false.
            // So fullSync should be false (B's authoritative answer).
            expect(asPrivate(h.mempool).fullSync).toBe(false);
        });

        it('keeps the latest answer when callbacks finish out of order', async () => {
            // Similar to the prior test, but with three concurrent callbacks
            // to verify the staleness logic scales. A and B finish stale, C wins.
            const h = await makeWatcherHarness();

            const pending: Array<(v: { blockHeight: number }) => void> = [];
            h.rpcSpy.mockImplementation(
                () =>
                    new Promise<{ blockHeight: number }>((r) => {
                        pending.push(r);
                    }),
            );

            const cbA = h.triggerCallback(100n);
            await flushMicrotasks();
            const cbB = h.triggerCallback(101n);
            await flushMicrotasks();
            const cbC = h.triggerCallback(102n);
            await flushMicrotasks();

            // All three are suspended in their RPC calls.
            expect(pending.length).toBe(3);
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(102n);

            // Resolve in reverse order: C first, then A, then B.
            pending[2]({ blockHeight: 101 }); // C: tip=102, 102>=101 → true
            pending[0]({ blockHeight: 999 }); // A: stale, must NOT update
            pending[1]({ blockHeight: 999 }); // B: stale, must NOT update

            await Promise.all([cbA, cbB, cbC]);

            // Only C's answer should stick.
            expect(asPrivate(h.mempool).fullSync).toBe(true);
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(102n);
        });
    });

    /* --------------------------- Reorg scenarios -------------------------- */

    describe('reorg scenarios', () => {
        it('updates latestObservedHeight on regression (rollback)', async () => {
            const h = await makeWatcherHarness();
            h.rpcSpy.mockResolvedValue({ blockHeight: 99 });

            await h.triggerCallback(100n);
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(100n);

            // Reorg-induced rollback.
            await h.triggerCallback(95n);
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(95n);
        });

        it('handles a forward-back-forward reorg sequence cleanly', async () => {
            const h = await makeWatcherHarness();
            // Bitcoin tip stays at 100 (blockHeight=99 → tip = 100).
            // The fullSync threshold is `blockHeight >= tip - 1`, so heights
            // 99 and 100 are considered caught up; everything below is not.
            h.rpcSpy.mockResolvedValue({ blockHeight: 99 });

            await h.triggerCallback(100n);
            expect(asPrivate(h.mempool).fullSync).toBe(true);

            await h.triggerCallback(95n); // rollback
            // 95 >= 99 is false → behind.
            expect(asPrivate(h.mempool).fullSync).toBe(false);

            await h.triggerCallback(96n);
            expect(asPrivate(h.mempool).fullSync).toBe(false);

            await h.triggerCallback(97n);
            expect(asPrivate(h.mempool).fullSync).toBe(false);

            await h.triggerCallback(98n);
            expect(asPrivate(h.mempool).fullSync).toBe(false);

            // 99 is exactly at the 1-block tolerance boundary → caught up.
            await h.triggerCallback(99n);
            expect(asPrivate(h.mempool).fullSync).toBe(true);

            await h.triggerCallback(100n); // exactly at tip
            expect(asPrivate(h.mempool).fullSync).toBe(true);
        });

        it('handles a same-height reorg by re-evaluating fullSync', async () => {
            // Bitcoin tip changes due to reorg: was 100, now 99.
            const h = await makeWatcherHarness();

            h.rpcSpy.mockResolvedValueOnce({ blockHeight: 99 }); // tip 100
            await h.triggerCallback(100n);
            expect(asPrivate(h.mempool).fullSync).toBe(true);

            // Reorg: Bitcoin tip is now 105 (a competing chain extended).
            // The watcher fires again with the same blockHeight=100 (the
            // indexer is still at 100 on its current chain view).
            h.rpcSpy.mockResolvedValueOnce({ blockHeight: 104 }); // tip 105
            await h.triggerCallback(100n);
            // 100 >= 104 is false → fullSync should flip to false.
            expect(asPrivate(h.mempool).fullSync).toBe(false);
        });
    });

    /* --------------------------- RPC error handling ----------------------- */

    describe('RPC error handling', () => {
        it('leaves fullSync untouched if getBlockHeight throws', async () => {
            const h = await makeWatcherHarness();
            asPrivate(h.mempool).fullSync = true; // pre-existing state
            h.rpcSpy.mockRejectedValue(new Error('rpc connection lost'));

            // Should not throw out of the callback.
            await expect(h.triggerCallback(100n)).resolves.toBeUndefined();

            // fullSync was NOT clobbered.
            expect(asPrivate(h.mempool).fullSync).toBe(true);
        });

        it('leaves fullSync untouched if getBlockHeight returns null', async () => {
            const h = await makeWatcherHarness();
            asPrivate(h.mempool).fullSync = true;
            h.rpcSpy.mockResolvedValue(null);

            await h.triggerCallback(100n);

            expect(asPrivate(h.mempool).fullSync).toBe(true);
        });

        it('does not let an RPC failure break subsequent callbacks', async () => {
            const h = await makeWatcherHarness();

            h.rpcSpy.mockRejectedValueOnce(new Error('transient network blip'));
            await h.triggerCallback(100n);

            // Next callback succeeds.
            h.rpcSpy.mockResolvedValueOnce({ blockHeight: 99 });
            await h.triggerCallback(101n);

            expect(asPrivate(h.mempool).fullSync).toBe(true);
            expect(asPrivate(h.mempool).latestObservedHeight).toBe(101n);
        });
    });
});
