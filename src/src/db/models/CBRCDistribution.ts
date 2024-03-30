import { ObjectId } from 'mongodb';
import { BaseModel } from './BaseModel';
import { ICBRCDistributionDocument, ICBRCDistributionDocumentBox } from './interfaces/ICBRCDistributionDocument.js';

export class CBRCDistribution extends BaseModel {
    public prev: ObjectId;
    public poolId: string;
    public box: ICBRCDistributionDocumentBox[];
    public baseBlock: number;
    public distBlock: number;
    public xin: ObjectId;
    public xout: ObjectId;
    public complete: BigInt;

    constructor(readonly cbrcDistributionDocument: ICBRCDistributionDocument) {
        super(cbrcDistributionDocument._id,
            cbrcDistributionDocument.version);
        this.prev = cbrcDistributionDocument.prev;
        this.poolId = cbrcDistributionDocument.poolId;
        this.box = cbrcDistributionDocument.box;
        this.baseBlock = cbrcDistributionDocument.baseBlock;
        this.distBlock = cbrcDistributionDocument.distBlock;
        this.xin = cbrcDistributionDocument.xin;
        this.xout = cbrcDistributionDocument.xout;
        this.complete = cbrcDistributionDocument.complete;
    }
}
