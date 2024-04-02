import { BaseModel } from '@btc-vision/motoswapdb';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';

export class Contract extends BaseModel {
    constructor(readonly contractDocument: IContractDocument) {
        super(contractDocument._id, contractDocument.version);
    }

    public override toDocument(): Readonly<IContractDocument> {
        const document: IContractDocument = {
            version: this.version,
            _id: this._id,
        };

        return document;
    }
}
