import { Binary, Decimal128 } from 'mongodb';

export interface ITargetEpochDocument {
    readonly epochNumber: Decimal128;
    readonly difficulty: number;

    readonly salt: Binary;
    readonly publicKey: Binary;

    graffiti?: Binary;
    readonly signature: Binary;
}

export interface PendingTargetEpoch {
    readonly target: Buffer;
    readonly nextEpochNumber: bigint;
    readonly targetHash: Buffer;
}
