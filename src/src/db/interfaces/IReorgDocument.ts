import { Decimal128 } from 'mongodb';

export interface IReorgData {
    readonly timestamp: Date;

    readonly fromBlock: bigint;
    readonly toBlock: bigint;
}

export interface IReorgDocument {
    readonly timestamp: Date;

    readonly fromBlock: Decimal128;
    toBlock: Decimal128;
}
