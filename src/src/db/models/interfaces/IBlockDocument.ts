import { Document } from 'mongodb';

export interface IBlockDocument extends Document {
    readonly version: number,
    readonly height: number,
    readonly hash: string,
    readonly ntx: number,
    readonly ntr: number,
    readonly nops: number,
    readonly nopserr: number,
    readonly miner: string,
    readonly time: number
}
