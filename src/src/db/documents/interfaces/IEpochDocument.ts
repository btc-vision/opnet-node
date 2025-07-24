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
}
