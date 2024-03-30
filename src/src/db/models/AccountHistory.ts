import { ObjectId } from 'mongodb';
import { BaseModel } from './BaseModel';
import { IAccountHistoryDocument } from './interfaces/IAccountHistoryDocument.js'

export class AccountHistory extends BaseModel {
    public metaOperation: ObjectId;
    public account: ObjectId;
    public source: string;
    public amount: BigInt;

    constructor(readonly accountHistoryDocument: IAccountHistoryDocument) {
        super(accountHistoryDocument._id,
            accountHistoryDocument.version);

        this.metaOperation = accountHistoryDocument.metaOperation;
        this.account = accountHistoryDocument.account;
        this.source = accountHistoryDocument.source;
        this.amount = accountHistoryDocument.amount;
    }
}
