/**
 * Unit tests for ReorgDetector — the API-thread inference layer that
 * decides when to fire route.onReorg().
 *
 * The API thread does not get CHAIN_REORG messages from the indexer; it
 * only sees an inProgressBlock value via MongoDB polling. From the
 * resulting (height, hash, previousBlockHash) triples we infer reorgs:
 *
 *   - height regression                             -> reorg
 *   - same height, different hash                   -> reorg
 *   - height+1 step but previousBlockHash mismatch  -> reorg
 *   - bigger forward jump                           -> NOT flagged (sync catch-up)
 *   - first observation ever                        -> NOT flagged
 */
import { describe, expect, it } from 'vitest';

import { ReorgDetector } from '../../src/src/api/reorg/ReorgDetector.js';

describe('ReorgDetector', () => {
    it('returns false for the first observation (no prior tip)', () => {
        const d = new ReorgDetector();
        expect(d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' })).toBe(false);
    });

    it('flags height regression as a reorg', () => {
        const d = new ReorgDetector();
        d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' });

        expect(d.observe({ height: 99n, hash: 'B', previousBlockHash: 'parent-B' })).toBe(true);
    });

    it('flags same-height-different-hash as a reorg', () => {
        const d = new ReorgDetector();
        d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' });

        expect(d.observe({ height: 100n, hash: 'B', previousBlockHash: 'parent-B' })).toBe(true);
    });

    it('does NOT flag the steady-state +1 forward step', () => {
        const d = new ReorgDetector();
        d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' });

        // Block 101 extends A: previousBlockHash === 'A'.
        expect(d.observe({ height: 101n, hash: 'B', previousBlockHash: 'A' })).toBe(false);
    });

    it('flags +1 forward step with broken hash chain as a reorg', () => {
        const d = new ReorgDetector();
        d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' });

        // Block 101 should chain off A but its previousBlockHash is X.
        expect(d.observe({ height: 101n, hash: 'B', previousBlockHash: 'X' })).toBe(true);
    });

    it('does NOT flag a forward jump greater than 1 (sync catch-up)', () => {
        const d = new ReorgDetector();
        d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' });

        // The API thread can fall behind during heavy indexer activity. A
        // forward jump >1 is not reliably distinguishable from a reorg
        // without extra information, so the detector intentionally does
        // not flag it. The conservative behavior keeps the cache effective
        // when the node is simply catching up.
        expect(d.observe({ height: 105n, hash: 'B', previousBlockHash: 'parent-B' })).toBe(false);
    });

    it('tolerates an empty previousBlockHash on +1 step (genesis edge)', () => {
        const d = new ReorgDetector();
        d.observe({ height: 0n, hash: 'genesis', previousBlockHash: '' });

        // We never want to flag genesis-style edges as reorgs.
        expect(d.observe({ height: 1n, hash: 'A', previousBlockHash: '' })).toBe(false);
    });

    it('updates state on each observation so consecutive reorgs are independent', () => {
        const d = new ReorgDetector();

        // Steady state.
        d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' });

        // Reorg 1: same-height swap.
        expect(d.observe({ height: 100n, hash: 'B', previousBlockHash: 'parent-B' })).toBe(true);

        // Now baseline is B at 100. A height regression from there is also
        // a reorg.
        expect(d.observe({ height: 98n, hash: 'C', previousBlockHash: 'parent-C' })).toBe(true);

        // And a clean +1 from C is steady state again.
        expect(d.observe({ height: 99n, hash: 'D', previousBlockHash: 'C' })).toBe(false);
    });

    it('reset() returns the detector to the no-prior-tip state', () => {
        const d = new ReorgDetector();
        d.observe({ height: 100n, hash: 'A', previousBlockHash: 'parent-A' });
        expect(d.lastObservedTip).not.toBeUndefined();

        d.reset();
        expect(d.lastObservedTip).toBeUndefined();

        // Post-reset, the first observation can't be a reorg.
        expect(d.observe({ height: 50n, hash: 'X', previousBlockHash: 'parent-X' })).toBe(false);
    });
});
