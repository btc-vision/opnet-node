import { describe, expect, it } from 'vitest';
import { Binary, Collection, Db } from 'mongodb';
import { DataConverter } from '@btc-vision/bsi-common';
import { TargetEpochRepository } from '../../src/src/db/repositories/TargetEpochRepository.js';
import { ITargetEpochDocument } from '../../src/src/db/documents/interfaces/ITargetEpochDocument.js';

// H7: TargetEpochRepository.targetEpochExists (the epoch-submission dedup guard)
// queried a `publicKey` field that no TargetEpochs document has, documents are
// stored/upserted under `mldsaPublicKey`. A filter naming a field absent from the
// document never matches in MongoDB, so the guard always returned false, and the
// SubmitEpochRoute "already submitted" short-circuit was dead code (DoS amplification:
// every replay re-ran signature verification + DB writes that should have been skipped).

type Doc = Record<string, unknown>;

function valueEquals(a: unknown, b: unknown): boolean {
    if (a instanceof Binary && b instanceof Binary) {
        return a.toString('hex') === b.toString('hex');
    }

    return String(a) === String(b);
}

// Emulate MongoDB equality matching: a stored doc matches a filter only if every
// filter key is present on the doc with an equal value. A filter key the doc lacks
// (e.g. `publicKey`) can never match, exactly why the buggy query returned 0.
function matchesFilter(filter: Doc, doc: Doc): boolean {
    return Object.keys(filter).every((key) => key in doc && valueEquals(doc[key], filter[key]));
}

// Test double: overrides only getCollection so the repository's real query-building
// code runs against an in-memory collection that records the filters it receives.
class TestTargetEpochRepository extends TargetEpochRepository {
    public readonly countFilters: Doc[] = [];
    public readonly updateFilters: Doc[] = [];

    public constructor(private readonly stored: Doc[] = []) {
        super({} as Db);
    }

    protected override getCollection(): Collection<ITargetEpochDocument> {
        const collection = {
            countDocuments: (filter: Doc): Promise<number> => {
                this.countFilters.push(filter);
                return Promise.resolve(this.stored.filter((d) => matchesFilter(filter, d)).length);
            },
            updateOne: (filter: Doc): Promise<{ acknowledged: boolean }> => {
                this.updateFilters.push(filter);
                return Promise.resolve({ acknowledged: true });
            },
        };

        return collection as unknown as Collection<ITargetEpochDocument>;
    }
}

const EPOCH = 5n;
const SALT = new Uint8Array(32).fill(1);
const PUBKEY = new Uint8Array(32).fill(2);

function storedDoc(): Doc {
    return {
        epochNumber: DataConverter.toDecimal128(EPOCH),
        salt: new Binary(SALT),
        difficulty: 40,
        mldsaPublicKey: new Binary(PUBKEY),
        legacyPublicKey: new Binary(new Uint8Array(33)),
        signature: new Binary(new Uint8Array(64)),
    };
}

describe('TargetEpochRepository dedup guard (H7)', () => {
    it('the dedup query keys equal the save/upsert keys (regression: publicKey vs mldsaPublicKey)', async () => {
        const repo = new TestTargetEpochRepository();

        await repo.targetEpochExists(EPOCH, SALT, PUBKEY);
        await repo.saveTargetEpoch(storedDoc() as unknown as ITargetEpochDocument);

        const dedupKeys = Object.keys(repo.countFilters[0]).sort();
        const saveKeys = Object.keys(repo.updateFilters[0]).sort();

        // If these diverge, the guard can never match what was saved. The old code
        // queried `publicKey` while saving `mldsaPublicKey`, so this failed.
        expect(dedupKeys).toEqual(saveKeys);
        expect(dedupKeys).toContain('mldsaPublicKey');
        expect(dedupKeys).not.toContain('publicKey');
    });

    it('returns true when a matching (epoch, salt, mldsaPublicKey) was already saved', async () => {
        const repo = new TestTargetEpochRepository([storedDoc()]);

        // With the buggy `publicKey` filter this was false (guard dead); now true.
        expect(await repo.targetEpochExists(EPOCH, SALT, PUBKEY)).toBe(true);
    });

    it('returns false for a different pubkey (no false-positive dedup)', async () => {
        const repo = new TestTargetEpochRepository([storedDoc()]);
        const otherPubkey = new Uint8Array(32).fill(9);

        expect(await repo.targetEpochExists(EPOCH, SALT, otherPubkey)).toBe(false);
    });

    it('returns false when nothing is stored', async () => {
        const repo = new TestTargetEpochRepository();

        expect(await repo.targetEpochExists(EPOCH, SALT, PUBKEY)).toBe(false);
    });
});
