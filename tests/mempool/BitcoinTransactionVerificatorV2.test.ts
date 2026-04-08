/**
 * Tests for the H-04 fix in BitcoinTransactionVerificatorV2.onBlockChange.
 *
 * Audit findings addressed:
 *
 * H-04: A rejected getChallengeSolutionsAtHeight() call would permanently
 *       poison `blockChangeQueue`, halting all future block processing, and
 *       leave `allowedChallenges` holding a rejected promise that broke every
 *       subsequent verify() call. The fix:
 *         - splits the queue into a caller-visible `result` and a
 *           never-rejecting `blockChangeQueue` (trailing `.catch`),
 *         - retries failed fetches with exponential backoff,
 *         - aborts in-flight retries when a newer block height arrives,
 *         - assigns `allowedChallenges` only after a successful fetch.
 *
 * H-04 (reorg follow-up): Block height is not a safe cache key under chain
 *       reorgs (the same height can correspond to different chain states with
 *       different challenge solutions). The fix always refetches when called,
 *       relying on the targetSolutionsHeight check to collapse in-flight
 *       duplicate bursts.
 */

import '../utils/mockConfig.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networks } from '@btc-vision/bitcoin';
import { AddressMap } from '@btc-vision/transaction';
import { BitcoinTransactionVerificatorV2 } from '../../src/src/poc/mempool/verificator/bitcoin/v2/BitcoinTransactionVerificatorV2.js';
import type { ChallengeSolution } from '../../src/src/blockchain-indexer/processor/interfaces/TransactionPreimage.js';

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
    }),
    DebugLevel: { TRACE: 5, WARN: 1, INFO: 2, DEBUG: 3, NONE: 0 },
}));

vi.mock('@btc-vision/bitcoin-rpc', () => ({
    BitcoinRPC: vi.fn(function (this: Record<string, unknown>) {}),
    FeeEstimation: { CONSERVATIVE: 'CONSERVATIVE' },
}));

vi.mock('../../src/src/db/repositories/EpochRepository.js', () => ({
    EpochRepository: vi.fn(function (this: Record<string, unknown>) {}),
}));

/* ------------------------------------------------------------------------- */
/*                              Test helpers                                  */
/* ------------------------------------------------------------------------- */

interface PrivateState {
    targetSolutionsHeight: bigint;
    allowedChallenges: Promise<ChallengeSolution>;
    blockChangeQueue: Promise<void>;
    _epochRepository: { getChallengeSolutionsAtHeight: ReturnType<typeof vi.fn> };
}

function asPrivate(v: BitcoinTransactionVerificatorV2): PrivateState {
    return v as unknown as PrivateState;
}

function makeSolutions(): ChallengeSolution {
    return {
        solutions: new AddressMap<Uint8Array[]>(),
        legacyPublicKeys: new AddressMap<Uint8Array>(),
    };
}

function makeVerificator(): {
    verificator: BitcoinTransactionVerificatorV2;
    fetchSpy: ReturnType<typeof vi.fn>;
} {
    const fetchSpy = vi.fn<(h: bigint) => Promise<ChallengeSolution>>();

    const verificator = new BitcoinTransactionVerificatorV2(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: { collection: () => ({}) } } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        networks.regtest,
    );

    asPrivate(verificator)._epochRepository = {
        getChallengeSolutionsAtHeight: fetchSpy,
    };

    return { verificator, fetchSpy };
}

/**
 * Drain queued microtasks/timers without waiting on a specific promise.
 * Used when we need to let a callback run without blocking on a promise that
 * may itself be racing with our test's next action.
 */
async function flushMicrotasks(times: number = 4): Promise<void> {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

/* ------------------------------------------------------------------------- */
/*                                  Tests                                    */
/* ------------------------------------------------------------------------- */

describe('BitcoinTransactionVerificatorV2.onBlockChange', () => {
    // Override retry constants so the suite runs in milliseconds rather than
    // ~15 seconds per exhaustion test. The defaults are private static, but
    // TypeScript private/readonly are not enforced at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ClassRef = BitcoinTransactionVerificatorV2 as any;

    let originalRetryDelay: number;
    let originalMaxRetries: number;
    let originalAbortPoll: number;

    beforeEach(() => {
        originalRetryDelay = ClassRef.RETRY_BASE_DELAY_MS;
        originalMaxRetries = ClassRef.MAX_RETRIES;
        originalAbortPoll = ClassRef.ABORT_POLL_INTERVAL_MS;

        ClassRef.RETRY_BASE_DELAY_MS = 1;
        ClassRef.MAX_RETRIES = 3;
        ClassRef.ABORT_POLL_INTERVAL_MS = 1;
    });

    afterEach(() => {
        ClassRef.RETRY_BASE_DELAY_MS = originalRetryDelay;
        ClassRef.MAX_RETRIES = originalMaxRetries;
        ClassRef.ABORT_POLL_INTERVAL_MS = originalAbortPoll;
        vi.restoreAllMocks();
    });

    /* --------------------------- Basic behavior --------------------------- */

    describe('basic behavior', () => {
        it('starts with empty initial state', async () => {
            const { verificator } = makeVerificator();
            const state = asPrivate(verificator);

            expect(state.targetSolutionsHeight).toBe(-1n);

            const initial = await state.allowedChallenges;
            expect(initial).toBeDefined();
            expect(initial.solutions).toBeInstanceOf(AddressMap);
            expect(initial.legacyPublicKeys).toBeInstanceOf(AddressMap);
        });

        it('fetches and applies solutions on first onBlockChange', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol = makeSolutions();
            fetchSpy.mockResolvedValue(sol);

            await verificator.onBlockChange(100n);

            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(fetchSpy).toHaveBeenCalledWith(100n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol);
        });

        it('advances forward through sequential heights', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol100 = makeSolutions();
            const sol101 = makeSolutions();
            const sol102 = makeSolutions();

            fetchSpy.mockImplementation((h: bigint) => {
                if (h === 100n) return Promise.resolve(sol100);
                if (h === 101n) return Promise.resolve(sol101);
                if (h === 102n) return Promise.resolve(sol102);
                throw new Error(`unexpected height ${h}`);
            });

            await verificator.onBlockChange(100n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol100);

            await verificator.onBlockChange(101n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol101);

            await verificator.onBlockChange(102n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol102);

            expect(fetchSpy).toHaveBeenCalledTimes(3);
        });
    });

    /* ----------------------- Reorg correctness ---------------------------- */

    describe('reorg correctness', () => {
        it('refetches when called twice with the same height (same-height reorg)', async () => {
            // This is the core scenario the audit follow-up identified: after a
            // reorg, the same block height can correspond to a different chain
            // state with different challenge solutions. The fix always refetches
            // when called instead of using height as a cache key.
            const { verificator, fetchSpy } = makeVerificator();
            const sol100v1 = makeSolutions();
            const sol100v2 = makeSolutions();

            let call = 0;
            fetchSpy.mockImplementation(() => {
                call++;
                return Promise.resolve(call === 1 ? sol100v1 : sol100v2);
            });

            await verificator.onBlockChange(100n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol100v1);
            expect(fetchSpy).toHaveBeenCalledTimes(1);

            // Reorg: a different chain now claims block 100. Same height,
            // different solutions.
            await verificator.onBlockChange(100n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol100v2);
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        });

        it('refetches when height regresses (rollback before replay)', async () => {
            // Typical reorg path: indexer rolls back from 100 to 95, then
            // re-processes forward. We must apply the rolled-back height's
            // solutions, not stick with the pre-reorg cached values.
            const { verificator, fetchSpy } = makeVerificator();
            const sol100 = makeSolutions();
            const sol95 = makeSolutions();

            fetchSpy.mockImplementation((h: bigint) =>
                Promise.resolve(h === 100n ? sol100 : sol95),
            );

            await verificator.onBlockChange(100n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol100);

            // Rollback to 95.
            await verificator.onBlockChange(95n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol95);
        });

        it('refetches on every call across a back-and-forth reorg sequence', async () => {
            // Complex reorg: 100 -> 95 (rollback) -> 96 -> 97 -> 100 (replay).
            // The final 100 fetch must use NEW chain solutions, even though
            // 100 was the height before the rollback.
            const { verificator, fetchSpy } = makeVerificator();
            const sol100Old = makeSolutions();
            const sol95 = makeSolutions();
            const sol96 = makeSolutions();
            const sol97 = makeSolutions();
            const sol100New = makeSolutions();

            const heights = [100n, 95n, 96n, 97n, 100n];
            const sols = [sol100Old, sol95, sol96, sol97, sol100New];
            let idx = 0;
            fetchSpy.mockImplementation((h: bigint) => {
                expect(h).toBe(heights[idx]);
                return Promise.resolve(sols[idx++]);
            });

            for (const h of heights) {
                await verificator.onBlockChange(h);
            }

            expect(fetchSpy).toHaveBeenCalledTimes(5);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol100New);
        });
    });

    /* ---------------------------- Retry behavior -------------------------- */

    describe('retry behavior', () => {
        it('retries on transient failure and applies the eventual success', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol = makeSolutions();

            let call = 0;
            fetchSpy.mockImplementation(() => {
                call++;
                if (call < 3) {
                    return Promise.reject(new Error('transient db hiccup'));
                }
                return Promise.resolve(sol);
            });

            await verificator.onBlockChange(100n);

            expect(fetchSpy).toHaveBeenCalledTimes(3);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol);
        });

        it('rejects the caller promise after exhausting all retries', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            fetchSpy.mockRejectedValue(new Error('permanent db failure'));

            // Capture the initial empty-solutions promise so we can verify
            // it has not been replaced after a failed call.
            const initialChallenges = asPrivate(verificator).allowedChallenges;

            await expect(verificator.onBlockChange(100n)).rejects.toThrow('permanent db failure');

            // MAX_RETRIES=3 means 4 total attempts (initial + 3 retries).
            expect(fetchSpy).toHaveBeenCalledTimes(4);
            // allowedChallenges must NOT have been replaced because the fetch
            // never succeeded.
            expect(asPrivate(verificator).allowedChallenges).toBe(initialChallenges);
        });

        it('keeps allowedChallenges at the last known-good value after exhaustion', async () => {
            // The audit's killer scenario: a single failure must not poison
            // allowedChallenges. verify() reads `await this.allowedChallenges`
            // on every transaction; if that field becomes a rejected promise,
            // every subsequent verify() throws.
            const { verificator, fetchSpy } = makeVerificator();
            const sol100 = makeSolutions();

            // First call succeeds.
            fetchSpy.mockResolvedValueOnce(sol100);
            await verificator.onBlockChange(100n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol100);

            // Second call fails all retries.
            fetchSpy.mockRejectedValue(new Error('db down'));
            await expect(verificator.onBlockChange(101n)).rejects.toThrow('db down');

            // allowedChallenges must STILL resolve to sol100 (last known-good),
            // not be a rejected promise.
            const stillGood = await asPrivate(verificator).allowedChallenges;
            expect(stillGood).toBe(sol100);
        });

        it('keeps the queue healthy after exhaustion (next call can succeed)', async () => {
            // Audit H-04 core: a rejected callback must not permanently
            // poison blockChangeQueue. The next onBlockChange must work.
            const { verificator, fetchSpy } = makeVerificator();
            const sol102 = makeSolutions();

            fetchSpy.mockRejectedValueOnce(new Error('boom'));
            fetchSpy.mockRejectedValueOnce(new Error('boom'));
            fetchSpy.mockRejectedValueOnce(new Error('boom'));
            fetchSpy.mockRejectedValueOnce(new Error('boom'));

            await expect(verificator.onBlockChange(101n)).rejects.toThrow('boom');

            // Queue should NOT be poisoned. Next call must work.
            fetchSpy.mockResolvedValueOnce(sol102);
            await verificator.onBlockChange(102n);

            expect(await asPrivate(verificator).allowedChallenges).toBe(sol102);
        });

        it('does not leak a rejected blockChangeQueue after exhaustion', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            fetchSpy.mockRejectedValue(new Error('boom'));

            await expect(verificator.onBlockChange(100n)).rejects.toThrow('boom');

            // The internal queue field must be a resolved (or pending-but-
            // never-rejecting) promise, NOT a rejected one.
            const queue = asPrivate(verificator).blockChangeQueue;
            // Awaiting must not throw.
            await expect(queue).resolves.toBeUndefined();
        });
    });

    /* ----------------------- Stale fetch abandonment ---------------------- */

    describe('staleness and abandonment', () => {
        it('abandons a stale fetch when a newer height arrives mid-DB-call', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol100 = makeSolutions();
            const sol101 = makeSolutions();

            // First fetch hangs until we resolve it manually.
            let resolve100!: (s: ChallengeSolution) => void;
            const pending100 = new Promise<ChallengeSolution>((r) => {
                resolve100 = r;
            });
            fetchSpy.mockImplementationOnce(() => pending100);
            fetchSpy.mockImplementationOnce(() => Promise.resolve(sol101));

            // Kick off 100 (don't await, it's stuck in pending100).
            const p100 = verificator.onBlockChange(100n);
            await flushMicrotasks();

            // Now request 101. This advances target to 101 synchronously.
            const p101 = verificator.onBlockChange(101n);

            // Resolve 100's DB query. Its post-await staleness check should
            // see target=101 and abandon WITHOUT applying sol100.
            resolve100(sol100);

            await p100;
            await p101;

            // The final state must reflect 101, NOT 100.
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol101);
            expect(await asPrivate(verificator).allowedChallenges).not.toBe(sol100);
        });

        it('abandons a stale retry during backoff sleep', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol101 = makeSolutions();

            let attempts = 0;
            fetchSpy.mockImplementation((h: bigint) => {
                attempts++;
                if (h === 100n) {
                    return Promise.reject(new Error('100 failed'));
                }
                return Promise.resolve(sol101);
            });

            // Kick off 100. It'll fail and start backing off.
            const p100 = verificator.onBlockChange(100n);
            // Let the first attempt fail and the sleep start.
            await flushMicrotasks();

            // Bump to 101 while 100 is sleeping.
            const p101 = verificator.onBlockChange(101n);

            // Both should resolve. 100's promise resolves successfully because
            // it abandons cleanly (return, not throw) when target advances.
            await p100;
            await p101;

            // Final state is 101.
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol101);

            // Critical: 100's retry loop should NOT have run all MAX_RETRIES+1
            // attempts. With abortable sleep, it should bail after 1-2
            // attempts at most.
            const attemptsFor100 = attempts - 1; // -1 for 101's success
            expect(attemptsFor100).toBeLessThan(4);
        });

        it('collapses a burst of rapid-fire calls to the latest height', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol = makeSolutions();
            fetchSpy.mockResolvedValue(sol);

            // Fire 5 calls in the same tick.
            const promises = [
                verificator.onBlockChange(100n),
                verificator.onBlockChange(101n),
                verificator.onBlockChange(102n),
                verificator.onBlockChange(103n),
                verificator.onBlockChange(104n),
            ];

            // After all sync calls, target should already be 104.
            expect(asPrivate(verificator).targetSolutionsHeight).toBe(104n);

            await Promise.all(promises);

            // Final state must be 104, not 100. The final allowedChallenges
            // is the result of the single fetch that ran (for height 104).
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol);

            // All callbacks ran sequentially, but only the one matching
            // target=104 actually fetched. Earlier ones returned early.
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(fetchSpy).toHaveBeenCalledWith(104n);
        });

        it('preserves caller-visible rejection while keeping queue healthy', async () => {
            // The fix splits the queue into a caller-visible `result` (which
            // can reject) and a never-rejecting `blockChangeQueue` (trailing
            // .catch). Verify both halves of this contract.
            const { verificator, fetchSpy } = makeVerificator();
            fetchSpy.mockRejectedValue(new Error('caller should see this'));

            const callerPromise = verificator.onBlockChange(100n);

            // The caller-visible promise rejects.
            await expect(callerPromise).rejects.toThrow('caller should see this');

            // But the internal queue stays alive.
            const sol = makeSolutions();
            fetchSpy.mockResolvedValueOnce(sol);
            await verificator.onBlockChange(101n);
            expect(await asPrivate(verificator).allowedChallenges).toBe(sol);
        });
    });

    /* -------------------------- Concurrent races -------------------------- */

    describe('concurrent races', () => {
        it('does not apply a stale result when a newer height succeeds first', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol100 = makeSolutions();
            const sol101 = makeSolutions();

            // 100's fetch hangs. 101's fetch resolves immediately.
            // Both run sequentially through the queue, but the staleness
            // check protects 100 from clobbering 101.
            let resolve100!: (s: ChallengeSolution) => void;
            const pending100 = new Promise<ChallengeSolution>((r) => {
                resolve100 = r;
            });
            fetchSpy.mockImplementationOnce(() => pending100);
            fetchSpy.mockImplementationOnce(() => Promise.resolve(sol101));

            const p100 = verificator.onBlockChange(100n);
            await flushMicrotasks();
            const p101 = verificator.onBlockChange(101n);

            // Resolve 100 LAST. Even though it resolves last, the staleness
            // check in fetchAndApplyChallenges (post-await) should reject it.
            resolve100(sol100);
            await Promise.all([p100, p101]);

            expect(await asPrivate(verificator).allowedChallenges).toBe(sol101);
        });

        it('handles a regression-then-advance sequence correctly under load', async () => {
            const { verificator, fetchSpy } = makeVerificator();
            const sol99 = makeSolutions();
            const sol100 = makeSolutions();
            const sol101 = makeSolutions();

            fetchSpy.mockImplementation((h: bigint) => {
                if (h === 99n) return Promise.resolve(sol99);
                if (h === 100n) return Promise.resolve(sol100);
                if (h === 101n) return Promise.resolve(sol101);
                throw new Error(`unexpected ${h}`);
            });

            // Forward then back then forward again.
            await verificator.onBlockChange(100n);
            await verificator.onBlockChange(99n);
            await verificator.onBlockChange(100n);
            await verificator.onBlockChange(101n);

            expect(await asPrivate(verificator).allowedChallenges).toBe(sol101);
            expect(fetchSpy).toHaveBeenCalledTimes(4);
        });
    });
});
