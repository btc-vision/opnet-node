import { Document, ObjectId } from 'mongodb';

export interface IAccountHistoryDocument extends Document {
    readonly version: number;
    readonly metaOperation: ObjectId;
    readonly account: ObjectId;
    readonly source: string;
    readonly amount: BigInt;
}
