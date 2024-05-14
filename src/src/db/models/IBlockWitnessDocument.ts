import { Binary, Decimal128 } from 'mongodb';

interface IOPNetWitnessDocument {
    readonly blockNumber: Decimal128 | bigint;
    readonly trusted: boolean;

    readonly signature: Binary;

    identity?: string;
    readonly opnetPubKey?: Binary;
}

export interface IBlockWitnessDocument extends IOPNetWitnessDocument {
    readonly blockNumber: Decimal128;
}

export interface IParsedBlockWitnessDocument extends IOPNetWitnessDocument {
    readonly blockNumber: bigint;
}
