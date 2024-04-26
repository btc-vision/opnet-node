export type MemoryValue = Uint8Array;

export interface ProvenMemoryValue {
    value: MemoryValue;
    proofs: string[];
    lastSeenAt: bigint;
}
