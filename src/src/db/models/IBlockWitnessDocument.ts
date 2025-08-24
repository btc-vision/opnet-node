import { Binary, Decimal128 } from 'mongodb';

interface IOPNetWitnessDocument {
    readonly blockNumber: Decimal128 | bigint;
    trusted: boolean;
    timestamp: Date;

    readonly signature: Binary;

    identity?: string;
    readonly publicKey?: Binary;

    readonly proofs?: Binary[];
}

export interface IBlockWitnessDocument extends IOPNetWitnessDocument {
    readonly blockNumber: Decimal128;
}

export interface IParsedBlockWitnessDocument extends IOPNetWitnessDocument {
    readonly blockNumber: bigint;
}
