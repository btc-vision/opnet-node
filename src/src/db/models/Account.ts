import { BaseModel } from './BaseModel';
import { IAccountDocument } from './interfaces/IAccountDocument.js'

export class Account extends BaseModel {
    public account: string;
    public ticker: string;
    public amount: BigInt;
    public lock: BigInt;
    public mint: BigInt;
    public stake: BigInt;

    constructor(readonly accountDocument: IAccountDocument) {
        super(accountDocument._id,
            accountDocument.version);

        this.account = accountDocument.account;
        this.ticker = accountDocument.ticker;
        this.amount = accountDocument.amount;
        this.lock = accountDocument.lock;
        this.mint = accountDocument.mint;
        this.stake = accountDocument.stake;
    }
}
