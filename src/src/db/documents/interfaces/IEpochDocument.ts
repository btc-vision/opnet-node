import { Binary, Decimal128 } from 'mongodb';

export interface IEpochMiner {
    readonly solution: Binary;
    readonly mldsaPublicKey: Binary;
    readonly legacyPublicKey: Binary;
    readonly salt: Binary;
    readonly graffiti?: Binary;
}

export interface IEpochDocument {
    readonly epochNumber: Decimal128;
    readonly epochHash: Binary;
    readonly epochRoot: Binary;

    readonly startBlock: Decimal128;
    readonly endBlock: Decimal128;

    readonly difficultyScaled: string;
    readonly minDifficulty?: string;

    readonly targetHash: Binary;

    readonly proposer: IEpochMiner;
    readonly proofs: Binary[];
}

export interface IEpoch {
    readonly startBlock: bigint;
    readonly endBlock: bigint;

    readonly targetHash: Uint8Array;
    readonly target: Uint8Array;
    readonly solution: Uint8Array;
    readonly salt: Uint8Array;
    readonly mldsaPublicKey: Uint8Array;
    readonly legacyPublicKey: Uint8Array;
    readonly graffiti?: Uint8Array;
    readonly solutionBits: number;
    readonly epochRoot: Uint8Array;
    readonly epochHash: Uint8Array;

    readonly proofs: Uint8Array[];
}
