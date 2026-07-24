import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SubmitEpochRoute transitively imports OPNetConsensus/Config at module load;
// the rate limiter itself reads neither at runtime.
vi.mock('../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: {
        consensus: { EPOCH: { MIN_DIFFICULTY: 35, BLOCKS_PER_EPOCH: 5n } },
        allowUnsafeSignatures: true,
    },
}));
vi.mock('../../src/src/config/Config.js', () => ({
    Config: { BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 } },
}));

import { SubmitEpochRoute } from '../../src/src/api/routes/api/v1/epochs/SubmitEpochRoute.js';

// H7 hardening: the unauthenticated /epoch/submit endpoint runs a signature
// verification per request, so a per-mldsaPublicKey sliding-window rate limit
// caps how fast a single key can force that work. 30 per 10s per key.
describe('SubmitEpochRoute submission rate limit (H7 hardening)', () => {
    let route: SubmitEpochRoute;

    // enforceSubmissionRateLimit is private; bracket access reaches it in the test.
    const submit = (key: string): void => route['enforceSubmissionRateLimit'](key);

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        route = new SubmitEpochRoute();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('allows up to 30 submissions per key in the window, rejects the 31st', () => {
        for (let i = 0; i < 30; i++) submit('0xabc');
        expect(() => submit('0xabc')).toThrow(/rate limit/i);
    });

    it('allows the key again after the 10s window passes', () => {
        for (let i = 0; i < 30; i++) submit('0xabc');
        expect(() => submit('0xabc')).toThrow();

        vi.setSystemTime(10_001);
        expect(() => submit('0xabc')).not.toThrow();
    });

    it('normalizes 0x prefix (same key shares the bucket)', () => {
        for (let i = 0; i < 30; i++) submit('abc');
        expect(() => submit('0xabc')).toThrow();
    });

    it('is independent per key', () => {
        for (let i = 0; i < 30; i++) submit('0xaaa');
        expect(() => submit('0xaaa')).toThrow();
        // A different key is unaffected by another key's limit.
        for (let i = 0; i < 30; i++) submit('0xbbb');
        expect(() => submit('0xbbb')).toThrow();
    });
});
