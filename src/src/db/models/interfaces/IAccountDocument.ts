import { Document } from 'mongodb';

export interface IAccountDocument extends Document {
    readonly version: number;
    readonly account: string;
    readonly ticker: string;
    readonly amount: BigInt;
    readonly lock: BigInt;
    readonly mint: BigInt;
    readonly stake: BigInt;
}
