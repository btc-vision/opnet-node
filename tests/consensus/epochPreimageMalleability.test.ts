import { describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// EpochValidator transitively imports OPNetConsensus/Config; mock them so the
// module loads in isolation. NOTE: the functions under test (calculatePreimage,
// countMatchingBits) do NOT read consensus/config at runtime, they are pure.
vi.mock('../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: {
        consensus: { EPOCH: { BLOCKS_PER_EPOCH: 5n, MIN_DIFFICULTY: 35 } },
        consensusEpochPatches: { PREIMAGE_CONCAT_PATCH_BLOCK_HEIGHT: 1_000_000n },
    },
}));
vi.mock('../../src/src/config/Config.js', () => ({
    Config: { BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 } },
}));

import { EpochValidator } from '../../src/src/poc/epoch/EpochValidator.js';
import { SHA1 } from '../../src/src/utils/SHA1.js';

// countMatchingBits is an instance method that only reads its two arguments.
// Construct with a dummy storage (never touched by the methods under test).
const validator = new EpochValidator(null as never);

function rand(n: number): Uint8Array {
    return new Uint8Array(crypto.randomBytes(n));
}

// Faithful reproduction of how the node derives the per-epoch target:
//   getEpochData(): targetHash = SHA1(checksumRoot)  (EpochValidator.ts:290-291)
function targetHashFor(checksumRoot: Uint8Array): Uint8Array {
    return SHA1.hashBuffer(checksumRoot);
}

// Faithful reproduction of the node's scoring:
//   preimage = calculatePreimage(checksumRoot, pubkey, salt)
//   score    = countMatchingBits(SHA1(preimage), targetHash)   (validateEpochSolution / validateEpochSubmission)
function score(checksumRoot: Uint8Array, pubkey: Uint8Array, salt: Uint8Array): number {
    const preimage = EpochValidator.calculatePreimage(checksumRoot, pubkey, salt);
    const hash = SHA1.hashBuffer(preimage);
    return validator.countMatchingBits(hash, targetHashFor(checksumRoot));
}

describe('epoch preimage, sanity of the primitives', () => {
    it('countMatchingBits(x, x) === 160 (SHA1 = 20 bytes * 8)', () => {
        const h = SHA1.hashBuffer(rand(32));
        expect(validator.countMatchingBits(h, h)).toBe(160);
    });

    it('honest random salt scores FAR below 160 (mining is supposed to be hard)', () => {
        const checksumRoot = rand(32);
        const pubkey = rand(32);
        let best = 0;
        // 2000 random tries, an honest miner grinding salt.
        for (let i = 0; i < 2000; i++) {
            best = Math.max(best, score(checksumRoot, pubkey, rand(32)));
        }
        // With 2000 tries the expected best is ~11 bits; assert it never gets near 160.
        expect(best).toBeLessThan(40);
    });
});

describe('ATTACK 1, salt = mldsaPublicKey cancels the XOR => preimage == checksumRoot => 160/160 for free', () => {
    it('yields the maximum 160 matching bits with zero work, for a 32-byte checksumRoot', () => {
        const checksumRoot = rand(32);
        const pubkey = rand(32);
        const salt = pubkey; // the attack: salt == pubkey

        const preimage = EpochValidator.calculatePreimage(checksumRoot, pubkey, salt);

        // preimage must equal checksumRoot exactly
        expect(Buffer.from(preimage)).toEqual(Buffer.from(checksumRoot));
        // therefore SHA1(preimage) == targetHash == SHA1(checksumRoot)
        expect(score(checksumRoot, pubkey, salt)).toBe(160);
    });

    it('holds for ANY checksumRoot and ANY pubkey (10 random trials)', () => {
        for (let t = 0; t < 10; t++) {
            const checksumRoot = rand(32);
            const pubkey = rand(32);
            expect(score(checksumRoot, pubkey, pubkey)).toBe(160);
        }
    });
});

describe('ATTACK 2, XOR malleability: re-attribute ANY victim solution to attacker key with zero work', () => {
    it('salt_A = pubkey_A XOR pubkey_V XOR salt_V reproduces the victim difficulty under the attacker key', () => {
        const checksumRoot = rand(32);

        // Victim mines a "good" solution honestly (we just fabricate one and measure it).
        const pubkeyV = rand(32);
        const saltV = rand(32);
        const victimScore = score(checksumRoot, pubkeyV, saltV);

        // Attacker uses their OWN key, no grinding.
        const pubkeyA = rand(32);
        const saltA = new Uint8Array(32);
        for (let i = 0; i < 32; i++) saltA[i] = pubkeyA[i] ^ pubkeyV[i] ^ saltV[i];

        const attackerScore = score(checksumRoot, pubkeyA, saltA);

        // Identical preimage => identical hash => identical difficulty, now under pubkeyA.
        const pV = EpochValidator.calculatePreimage(checksumRoot, pubkeyV, saltV);
        const pA = EpochValidator.calculatePreimage(checksumRoot, pubkeyA, saltA);
        expect(Buffer.from(pA)).toEqual(Buffer.from(pV));
        expect(attackerScore).toBe(victimScore);
    });
});

describe('concatenated preimage (useConcatenatedPreimage = true) kills both attacks', () => {
    // calculatePreimage(..., true) === concatenatePreimage === the 96-byte
    // concatenation checksumRoot || pubkey || salt, hashed with SHA1 by the caller.
    function fixedScore(checksumRoot: Uint8Array, pubkey: Uint8Array, salt: Uint8Array): number {
        const preimage = EpochValidator.calculatePreimage(checksumRoot, pubkey, salt, true);
        const hash = SHA1.hashBuffer(preimage);
        return validator.countMatchingBits(hash, targetHashFor(checksumRoot));
    }

    it('the concatenated preimage is checksumRoot || pubkey || salt (96 bytes, no SHA256)', () => {
        const checksumRoot = rand(32);
        const pubkey = rand(32);
        const salt = rand(32);

        const expected = Buffer.concat([checksumRoot, pubkey, salt]);

        expect(expected.length).toBe(96);
        expect(Buffer.from(EpochValidator.concatenatePreimage(checksumRoot, pubkey, salt))).toEqual(
            expected,
        );
        expect(Buffer.from(EpochValidator.calculatePreimage(checksumRoot, pubkey, salt, true))).toEqual(
            expected,
        );
    });

    it('ATTACK 1 no longer works: salt = pubkey does NOT reach 160', () => {
        const checksumRoot = rand(32);
        const pubkey = rand(32);
        expect(fixedScore(checksumRoot, pubkey, pubkey)).toBeLessThan(40);
    });

    it('ATTACK 2 no longer works: the XOR transform no longer reproduces the difficulty', () => {
        const checksumRoot = rand(32);
        const pubkeyV = rand(32);
        const saltV = rand(32);

        const pubkeyA = rand(32);
        const saltA = new Uint8Array(32);
        for (let i = 0; i < 32; i++) saltA[i] = pubkeyA[i] ^ pubkeyV[i] ^ saltV[i];

        const pV = EpochValidator.calculatePreimage(checksumRoot, pubkeyV, saltV, true);
        const pA = EpochValidator.calculatePreimage(checksumRoot, pubkeyA, saltA, true);
        expect(Buffer.from(pA)).not.toEqual(Buffer.from(pV));
    });
});

describe('height gating, usesConcatenatedPreimage flips at PREIMAGE_CONCAT_PATCH_BLOCK_HEIGHT (mocked 1_000_000)', () => {
    it('legacy XOR before activation, concatenated at/after activation', () => {
        expect(EpochValidator.usesConcatenatedPreimage(999_995n)).toBe(false);
        expect(EpochValidator.usesConcatenatedPreimage(1_000_000n)).toBe(true);
        expect(EpochValidator.usesConcatenatedPreimage(1_000_005n)).toBe(true);
    });

    it('calculatePreimage default (no flag) stays on legacy XOR, unchanged for historical epochs', () => {
        const checksumRoot = rand(32);
        const pubkey = rand(32);
        // salt = pubkey still yields 160 under legacy (proves default path is untouched)
        expect(score(checksumRoot, pubkey, pubkey)).toBe(160);
    });
});
