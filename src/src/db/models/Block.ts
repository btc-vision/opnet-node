import { BaseModel } from './BaseModel';
import { IBlockDocument } from './interfaces/IBlockDocument.js';


export class Block extends BaseModel {
    public height: number;
    public hash: string;
    public ntx: number;
    public ntr: number;
    public nops: number;
    public nopserr: number;
    public miner: string;
    public time: number;

    constructor(readonly blockDocument: IBlockDocument) {
        super(blockDocument._id,
            blockDocument.version);

        this.height = blockDocument.height;
        this.hash = blockDocument.hash;
        this.ntx = blockDocument.ntx;
        this.ntr = blockDocument.ntr;
        this.nops = blockDocument.nops;
        this.nopserr = blockDocument.nopserr;
        this.miner = blockDocument.miner;
        this.time = blockDocument.time;
    }
}
