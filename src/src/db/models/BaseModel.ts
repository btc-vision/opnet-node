import { ObjectId } from 'mongodb';
import { IBaseDocument } from '../documents/interfaces/IBaseDocument';
import { DBConstants } from '../DBConstants';

export abstract class BaseModel {
    public _id: ObjectId;
    public version: number;

    constructor(id?: ObjectId, version?: number) {
        this._id = id || new ObjectId(DBConstants.NULL_OBJECT_ID);
        this.version = version || 0;
    }

    public abstract toDocument(): Readonly<IBaseDocument>;
}