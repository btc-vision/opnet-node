import { ObjectId } from 'mongodb';
import { BaseModel } from './BaseModel';
import { ICBRCDeployDocument } from './interfaces/ICBRCDeployDocument.js'

export class CBRCDeploy extends BaseModel {
    public metaOp: ObjectId;
    public ticker: string;
    public tickerHex: string;
    public supply: BigInt;
    public stake: BigInt;
    public maximum: BigInt;
    public limit: BigInt;
    public dec: Number;
    public mint: boolean;
    public mintops: [number, number]; // !!!! TODO:

    constructor(readonly cbrcDeployDocument: ICBRCDeployDocument) {
        super(cbrcDeployDocument._id,
            cbrcDeployDocument.version);
        this.metaOp = cbrcDeployDocument.metaOp;
        this.ticker = cbrcDeployDocument.ticker;
        this.tickerHex = cbrcDeployDocument.tickerHex;
        this.supply = cbrcDeployDocument.supply;
        this.stake = cbrcDeployDocument.stake;
        this.maximum = cbrcDeployDocument.maximum;
        this.limit = cbrcDeployDocument.limit;
        this.dec = cbrcDeployDocument.dec;
        this.mint = cbrcDeployDocument.mint;
        this.mintops = cbrcDeployDocument.mintops;
    }
}
