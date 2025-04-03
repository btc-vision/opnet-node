import { AddressMap } from '@btc-vision/transaction';

export type MemoryValue = Uint8Array;

export interface ProvenMemoryValue {
    value: MemoryValue;
    proofs: string[];
    lastSeenAt: bigint;
}

export type ProvenPointers = AddressMap<Map<Uint8Array, ProvenMemoryValue | null>>;
