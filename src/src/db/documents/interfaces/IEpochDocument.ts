import { Binary, Decimal128 } from 'mongodb';

export interface IEpochMiner {
    readonly solution: Binary;
    readonly publicKey: Binary;
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

    readonly targetHash: Buffer;
    readonly target: Buffer;
    readonly solution: Buffer;
    readonly salt: Buffer;
    readonly publicKey: Buffer;
    readonly graffiti?: Buffer;
    readonly solutionBits: number;
    readonly epochRoot: Buffer;
    readonly epochHash: Buffer;

    readonly proofs: Buffer[];
}
