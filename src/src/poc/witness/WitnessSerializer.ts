import Long from 'long';
import {
    IBlockHeaderWitness,
    OPNetBlockWitness,
} from '../networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { ISyncBlockHeaderResponse } from '../networking/protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';

/**
 * Reconstruct a Long value from a structured-clone-degraded plain object.
 *
 * When objects cross a worker_threads boundary via postMessage, the structured
 * clone algorithm serialises Long instances into plain {low, high, unsigned}
 * objects, stripping all prototype methods (e.g. toBigInt(), toString()).
 * This helper detects the degraded form and rebuilds a proper Long instance.
 */
function toLong(val: unknown): Long {
    if (val instanceof Long) return val;

    if (typeof val === 'object' && val !== null && 'low' in val && 'high' in val) {
        const obj = val as { low: number; high: number; unsigned?: boolean };
        return Long.fromBits(obj.low, obj.high, obj.unsigned);
    }

    if (typeof val === 'string') return Long.fromString(val);
    if (typeof val === 'number') return Long.fromNumber(val);
    if (typeof val === 'bigint') return Long.fromString(val.toString());

    return Long.ZERO;
}

function reconstructWitnesses(witnesses: OPNetBlockWitness[]): OPNetBlockWitness[] {
    return witnesses.map((w) => ({
        ...w,
        timestamp: toLong(w.timestamp),
    }));
}

/**
 * Reconstruct Long values in an IBlockHeaderWitness after structured clone.
 */
export function reconstructBlockWitness(data: IBlockHeaderWitness): IBlockHeaderWitness {
    return {
        ...data,
        blockNumber: toLong(data.blockNumber),
        validatorWitnesses: data.validatorWitnesses
            ? reconstructWitnesses(data.validatorWitnesses)
            : data.validatorWitnesses,
        trustedWitnesses: data.trustedWitnesses
            ? reconstructWitnesses(data.trustedWitnesses)
            : data.trustedWitnesses,
    };
}

/**
 * Reconstruct Long values in an ISyncBlockHeaderResponse after structured clone.
 */
export function reconstructSyncResponse(
    data: ISyncBlockHeaderResponse,
): ISyncBlockHeaderResponse {
    return {
        ...data,
        blockNumber: toLong(data.blockNumber),
        validatorWitnesses: data.validatorWitnesses
            ? reconstructWitnesses(data.validatorWitnesses)
            : data.validatorWitnesses,
        trustedWitnesses: data.trustedWitnesses
            ? reconstructWitnesses(data.trustedWitnesses)
            : data.trustedWitnesses,
    };
}
