import { Document, ObjectId } from 'mongodb';

export interface ICBRCDistributionDocumentBox {
    ticker: string;
    amount: BigInt;
}

export interface ICBRCDistributionDocument extends Document {
    readonly version: number;
    readonly prev: ObjectId;
    readonly poolId: string;
    readonly box: ICBRCDistributionDocumentBox[];
    readonly baseBlock: number;
    readonly distBlock: number;
    readonly xin: ObjectId;
    readonly xout: ObjectId;
    readonly complete: BigInt;
}