import './setup.js';
import { describe, expect, it } from 'vitest';
import Long from 'long';
import {
    reconstructBlockWitness,
    reconstructSyncResponse,
} from '../../src/src/poc/witness/WitnessSerializer.js';
import { IBlockHeaderWitness } from '../../src/src/poc/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { ISyncBlockHeaderResponse } from '../../src/src/poc/networking/protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';

/** Helpers */

/**
 * Builds a minimal IBlockHeaderWitness with defaults that can be overridden.
 */
function makeWitness(
    overrides: Partial<IBlockHeaderWitness> = {},
): IBlockHeaderWitness {
    return {
        blockNumber: Long.fromNumber(100, true),
        blockHash: 'aabbccdd',
        previousBlockHash: '00112233',
        merkleRoot: 'deadbeef',
        receiptRoot: 'cafebabe',
        storageRoot: '01020304',
        checksumHash: 'ffee0011',
        checksumProofs: [],
        previousBlockChecksum: '44556677',
        txCount: 5,
        validatorWitnesses: [],
        trustedWitnesses: [],
        ...overrides,
    };
}

/**
 * Builds a minimal ISyncBlockHeaderResponse with defaults.
 */
function makeSyncResponse(
    overrides: Partial<ISyncBlockHeaderResponse> = {},
): ISyncBlockHeaderResponse {
    return {
        blockNumber: Long.fromNumber(200, true),
        validatorWitnesses: [],
        trustedWitnesses: [],
        ...overrides,
    };
}

/**
 * Simulates structured-clone degradation of a Long instance.
 * After postMessage, Long objects become plain {low, high, unsigned} objects.
 */
function degradeLong(long: Long): { low: number; high: number; unsigned: boolean } {
    return { low: long.low, high: long.high, unsigned: long.unsigned };
}

/** Tests */

describe('WitnessSerializer', () => {
    /** reconstructBlockWitness */
    describe('reconstructBlockWitness', () => {
        it('should reconstruct blockNumber Long from degraded {low, high, unsigned} object', () => {
            const original = Long.fromString('12345', true);
            const degraded = degradeLong(original);
            const witness = makeWitness({ blockNumber: degraded as unknown as Long });

            const result = reconstructBlockWitness(witness);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toString()).toBe('12345');
        });

        it('should reconstruct validator witness timestamps from degraded objects', () => {
            const timestamp = Long.fromNumber(1700000000000, true);
            const degradedTimestamp = degradeLong(timestamp);

            const witness = makeWitness({
                validatorWitnesses: [
                    {
                        identity: 'validator1',
                        signature: new Uint8Array([1, 2, 3]),
                        timestamp: degradedTimestamp as unknown as Long,
                    },
                ],
            });

            const result = reconstructBlockWitness(witness);

            expect(result.validatorWitnesses).toHaveLength(1);
            expect(result.validatorWitnesses[0].timestamp).toBeInstanceOf(Long);
            expect(result.validatorWitnesses[0].timestamp.toString()).toBe('1700000000000');
        });

        it('should reconstruct trusted witness timestamps from degraded objects', () => {
            const timestamp = Long.fromNumber(1700000000001, true);
            const degradedTimestamp = degradeLong(timestamp);

            const witness = makeWitness({
                trustedWitnesses: [
                    {
                        identity: 'trusted1',
                        signature: new Uint8Array([4, 5, 6]),
                        timestamp: degradedTimestamp as unknown as Long,
                    },
                ],
            });

            const result = reconstructBlockWitness(witness);

            expect(result.trustedWitnesses).toHaveLength(1);
            expect(result.trustedWitnesses[0].timestamp).toBeInstanceOf(Long);
            expect(result.trustedWitnesses[0].timestamp.toString()).toBe('1700000000001');
        });

        it('should handle already-valid Long instances (no-op)', () => {
            const blockNumber = Long.fromNumber(999, true);
            const timestamp = Long.fromNumber(1700000000000, true);

            const witness = makeWitness({
                blockNumber,
                validatorWitnesses: [
                    {
                        identity: 'v1',
                        signature: new Uint8Array([1]),
                        timestamp,
                    },
                ],
            });

            const result = reconstructBlockWitness(witness);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toString()).toBe('999');
            expect(result.validatorWitnesses[0].timestamp).toBeInstanceOf(Long);
            expect(result.validatorWitnesses[0].timestamp.toString()).toBe('1700000000000');
        });

        it('should handle string blockNumber values', () => {
            const witness = makeWitness({
                blockNumber: '54321' as unknown as Long,
            });

            const result = reconstructBlockWitness(witness);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toString()).toBe('54321');
        });

        it('should handle number blockNumber values', () => {
            const witness = makeWitness({
                blockNumber: 42 as unknown as Long,
            });

            const result = reconstructBlockWitness(witness);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toNumber()).toBe(42);
        });

        it('should handle bigint blockNumber values', () => {
            const witness = makeWitness({
                blockNumber: 99999n as unknown as Long,
            });

            const result = reconstructBlockWitness(witness);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toString()).toBe('99999');
        });

        it('should preserve all non-Long fields unchanged (blockHash, checksumHash, etc.)', () => {
            const original = Long.fromNumber(100, true);
            const degraded = degradeLong(original);

            const witness = makeWitness({
                blockNumber: degraded as unknown as Long,
                blockHash: 'my-block-hash',
                previousBlockHash: 'prev-hash',
                merkleRoot: 'my-merkle',
                receiptRoot: 'my-receipt',
                storageRoot: 'my-storage',
                checksumHash: 'my-checksum',
                previousBlockChecksum: 'prev-checksum',
                txCount: 42,
                checksumProofs: [{ proof: ['a', 'b'] }],
            });

            const result = reconstructBlockWitness(witness);

            expect(result.blockHash).toBe('my-block-hash');
            expect(result.previousBlockHash).toBe('prev-hash');
            expect(result.merkleRoot).toBe('my-merkle');
            expect(result.receiptRoot).toBe('my-receipt');
            expect(result.storageRoot).toBe('my-storage');
            expect(result.checksumHash).toBe('my-checksum');
            expect(result.previousBlockChecksum).toBe('prev-checksum');
            expect(result.txCount).toBe(42);
            expect(result.checksumProofs).toEqual([{ proof: ['a', 'b'] }]);
        });

        it('should handle empty validatorWitnesses array', () => {
            const witness = makeWitness({ validatorWitnesses: [] });

            const result = reconstructBlockWitness(witness);

            expect(result.validatorWitnesses).toEqual([]);
        });

        it('should handle empty trustedWitnesses array', () => {
            const witness = makeWitness({ trustedWitnesses: [] });

            const result = reconstructBlockWitness(witness);

            expect(result.trustedWitnesses).toEqual([]);
        });

        it('should handle undefined validatorWitnesses', () => {
            const witness = makeWitness();
            // Force undefined (the interface says it can be optional through spreading)
            const withUndefined = { ...witness, validatorWitnesses: undefined } as unknown as IBlockHeaderWitness;

            const result = reconstructBlockWitness(withUndefined);

            expect(result.validatorWitnesses).toBeUndefined();
        });

        it('should handle undefined trustedWitnesses', () => {
            const witness = makeWitness();
            const withUndefined = { ...witness, trustedWitnesses: undefined } as unknown as IBlockHeaderWitness;

            const result = reconstructBlockWitness(withUndefined);

            expect(result.trustedWitnesses).toBeUndefined();
        });

        it('should reconstruct multiple witnesses in array', () => {
            const ts1 = Long.fromNumber(1000, true);
            const ts2 = Long.fromNumber(2000, true);
            const ts3 = Long.fromNumber(3000, true);

            const witness = makeWitness({
                validatorWitnesses: [
                    {
                        identity: 'v1',
                        signature: new Uint8Array([1]),
                        timestamp: degradeLong(ts1) as unknown as Long,
                    },
                    {
                        identity: 'v2',
                        signature: new Uint8Array([2]),
                        timestamp: degradeLong(ts2) as unknown as Long,
                    },
                ],
                trustedWitnesses: [
                    {
                        identity: 't1',
                        signature: new Uint8Array([3]),
                        timestamp: degradeLong(ts3) as unknown as Long,
                    },
                ],
            });

            const result = reconstructBlockWitness(witness);

            expect(result.validatorWitnesses).toHaveLength(2);
            expect(result.validatorWitnesses[0].timestamp.toString()).toBe('1000');
            expect(result.validatorWitnesses[1].timestamp.toString()).toBe('2000');
            expect(result.trustedWitnesses).toHaveLength(1);
            expect(result.trustedWitnesses[0].timestamp.toString()).toBe('3000');
        });

        it('should reconstruct high-value blockNumber correctly (values requiring both low and high bits)', () => {
            // 2^33 = 8589934592, requires high=2, low=0
            const original = Long.fromString('8589934592', true);
            const degraded = degradeLong(original);

            expect(degraded.high).not.toBe(0); // Verify it actually uses the high bits

            const witness = makeWitness({
                blockNumber: degraded as unknown as Long,
            });

            const result = reconstructBlockWitness(witness);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toString()).toBe('8589934592');
        });

        it('should return Long.ZERO for unrecognized blockNumber types', () => {
            const witness = makeWitness({
                blockNumber: null as unknown as Long,
            });

            const result = reconstructBlockWitness(witness);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toNumber()).toBe(0);
        });

        it('should preserve witness identity and signature fields through reconstruction', () => {
            const sig = new Uint8Array([10, 20, 30, 40]);
            const pubKey = new Uint8Array([50, 60]);

            const witness = makeWitness({
                validatorWitnesses: [
                    {
                        identity: 'my-identity',
                        signature: sig,
                        publicKey: pubKey,
                        timestamp: degradeLong(Long.fromNumber(5000, true)) as unknown as Long,
                    },
                ],
            });

            const result = reconstructBlockWitness(witness);

            expect(result.validatorWitnesses[0].identity).toBe('my-identity');
            expect(result.validatorWitnesses[0].signature).toEqual(sig);
            expect(result.validatorWitnesses[0].publicKey).toEqual(pubKey);
        });
    });

    /** reconstructSyncResponse */
    describe('reconstructSyncResponse', () => {
        it('should reconstruct blockNumber Long from degraded object', () => {
            const original = Long.fromString('67890', true);
            const degraded = degradeLong(original);

            const response = makeSyncResponse({
                blockNumber: degraded as unknown as Long,
            });

            const result = reconstructSyncResponse(response);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toString()).toBe('67890');
        });

        it('should reconstruct witness timestamps in response', () => {
            const ts = Long.fromNumber(9999, true);

            const response = makeSyncResponse({
                validatorWitnesses: [
                    {
                        identity: 'val',
                        signature: new Uint8Array([1]),
                        timestamp: degradeLong(ts) as unknown as Long,
                    },
                ],
                trustedWitnesses: [
                    {
                        identity: 'trust',
                        signature: new Uint8Array([2]),
                        timestamp: degradeLong(ts) as unknown as Long,
                    },
                ],
            });

            const result = reconstructSyncResponse(response);

            expect(result.validatorWitnesses[0].timestamp).toBeInstanceOf(Long);
            expect(result.validatorWitnesses[0].timestamp.toString()).toBe('9999');
            expect(result.trustedWitnesses[0].timestamp).toBeInstanceOf(Long);
            expect(result.trustedWitnesses[0].timestamp.toString()).toBe('9999');
        });

        it('should preserve non-Long fields', () => {
            const response = makeSyncResponse({
                blockNumber: Long.fromNumber(300, true),
            });

            const result = reconstructSyncResponse(response);

            expect(result.blockNumber.toString()).toBe('300');
            expect(result.validatorWitnesses).toEqual([]);
            expect(result.trustedWitnesses).toEqual([]);
        });

        it('should handle undefined validatorWitnesses in sync response', () => {
            const response = {
                blockNumber: Long.fromNumber(100, true),
                validatorWitnesses: undefined,
                trustedWitnesses: [],
            } as unknown as ISyncBlockHeaderResponse;

            const result = reconstructSyncResponse(response);

            expect(result.validatorWitnesses).toBeUndefined();
            expect(result.trustedWitnesses).toEqual([]);
        });

        it('should handle undefined trustedWitnesses in sync response', () => {
            const response = {
                blockNumber: Long.fromNumber(100, true),
                validatorWitnesses: [],
                trustedWitnesses: undefined,
            } as unknown as ISyncBlockHeaderResponse;

            const result = reconstructSyncResponse(response);

            expect(result.validatorWitnesses).toEqual([]);
            expect(result.trustedWitnesses).toBeUndefined();
        });

        it('should handle string blockNumber in sync response', () => {
            const response = makeSyncResponse({
                blockNumber: '77777' as unknown as Long,
            });

            const result = reconstructSyncResponse(response);

            expect(result.blockNumber).toBeInstanceOf(Long);
            expect(result.blockNumber.toString()).toBe('77777');
        });
    });
});
