import { ObjectId } from 'mongodb';

export abstract class BaseModel {
    protected _id: ObjectId;
    protected version: number;

    constructor(id?: ObjectId, version?: number) {
        this._id = id || new ObjectId();
        this.version = version || 1;
    }

    incrementVersion() {
        this.version += 1;
    }
}