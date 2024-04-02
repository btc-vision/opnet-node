import { BaseModel } from '@btc-vision/motoswapdb';
import { IContractKeyPointerDocument } from '../documents/interfaces/IContractKeyPointerDocument.js'

export class ContractKeyPointer extends BaseModel {
    public contractAddress: string;
    public key: string;
    public pointer: string;

    constructor(readonly keyToPointerDocument: IContractKeyPointerDocument) {
        super(keyToPointerDocument._id,
            keyToPointerDocument.version);
        this.contractAddress = keyToPointerDocument.contractAddress;
        this.key = keyToPointerDocument.key;
        this.pointer = keyToPointerDocument.pointer;
    }

    public override toDocument(): Readonly<IContractKeyPointerDocument> {
        const document: IContractKeyPointerDocument = {
            contractAddress: this.contractAddress,
            key: this.key,
            pointer: this.pointer,
            version: this.version,
            _id: this._id
        };

        return document;
    }
}
