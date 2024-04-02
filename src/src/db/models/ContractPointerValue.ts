import { Binary } from 'mongodb';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';

export class ContractPointerValue {
    public contractAddress: string;
    public pointer: Uint8Array;
    public value: Uint8Array;

    constructor(readonly pointerValueDocument: IContractPointerValueDocument) {
        this.contractAddress = pointerValueDocument.contractAddress;
        this.pointer = pointerValueDocument.pointer.value();
        this.value = pointerValueDocument.value.value();
    }

    public toDocument(): Readonly<IContractPointerValueDocument> {
        const document: IContractPointerValueDocument = {
            contractAddress: this.contractAddress,
            value: new Binary(this.value),
            pointer: new Binary(this.pointer),
        };

        return document;
    }
}