/**
 * Reorg-detection logic for the API thread.
 *
 * The API thread does not receive CHAIN_REORG messages from the indexer.
 * It only sees inProgressBlock changes via the MongoDB polling in
 * BlockchainInfoRepository, which yields a stream of (height, hash,
 * previousBlockHash) triples. We infer a reorg by comparing each new tip
 * against the last one we saw:
 *
 *   - height regression                             -> reorg
 *   - same height, different hash                   -> reorg (same-height swap)
 *   - height+1 step but previousBlockHash mismatch  -> reorg (chain broken)
 *   - bigger forward jump                           -> NOT flagged (sync catch-up)
 *   - first observation ever                        -> NOT flagged
 *
 * A bigger forward jump is intentionally not flagged: when the API thread
 * lags behind the indexer it can catch up across several heights in one
 * poll, and we don't want to nuke the cache every time that happens.
 *
 * Pure data in / boolean out — no I/O, no logging — so it stays cheap to
 * unit test and easy to reason about.
 */
export interface TipObservation {
    readonly height: bigint;
    readonly hash: string;
    readonly previousBlockHash: string;
}

export class ReorgDetector {
    private lastTip: TipObservation | undefined;

    /**
     * Record a new tip and report whether it represents a reorg relative
     * to the previously observed tip. Always updates the internal state
     * so the next call has a fresh baseline.
     */
    public observe(tip: TipObservation): boolean {
        const reorged = this.detect(tip);
        this.lastTip = tip;
        return reorged;
    }

    /**
     * Pure predicate — does not mutate state. Useful in tests and for
     * callers that want to decide what to do before committing to it.
     */
    public detect(tip: TipObservation): boolean {
        const last = this.lastTip;
        if (last === undefined) {
            return false;
        }

        if (tip.height < last.height) {
            return true;
        }

        if (tip.height === last.height && tip.hash !== last.hash) {
            return true;
        }

        if (
            tip.height === last.height + 1n &&
            tip.previousBlockHash !== '' &&
            tip.previousBlockHash !== last.hash
        ) {
            return true;
        }

        return false;
    }

    public get lastObservedTip(): TipObservation | undefined {
        return this.lastTip;
    }

    public reset(): void {
        this.lastTip = undefined;
    }
}
