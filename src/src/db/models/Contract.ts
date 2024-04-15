import { BaseModel } from '@btc-vision/bsi-common';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';

export class Contract extends BaseModel {
    constructor(readonly contractDocument: IContractDocument) {
        super();
    }

    public override toDocument(): Readonly<IContractDocument> {
        const document: IContractDocument = {};

        return document;
    }
}
