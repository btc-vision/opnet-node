import { Document, ObjectId } from 'mongodb';

export interface ICBRCDeployDocument extends Document {
    readonly version: number;
    readonly metaOp: ObjectId;
    readonly ticker: string;
    readonly tickerHex: string;
    readonly supply: BigInt;
    readonly stake: BigInt;
    readonly maximum: BigInt;
    readonly limit: BigInt;
    readonly dec: Number;
    readonly mint: boolean;
    readonly mintops: [number, number]; // TODO: !!!!
}