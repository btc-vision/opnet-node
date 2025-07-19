import { Binary, Decimal128 } from 'mongodb';

// Local tracking of epoch submissions (my own proposed epochs)
export interface ITargetEpochDocument {
    readonly epochNumber: Decimal128; // Epoch number
    readonly difficulty: number; // Amount of bits of difficulty

    readonly salt: Binary;
    readonly publicKey: Binary;
}

export interface PendingTargetEpoch {
    readonly target: Buffer;
    readonly nextEpochNumber: bigint;
    readonly targetHash: Buffer;
}
