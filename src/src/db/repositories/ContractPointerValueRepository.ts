import { Binary, ClientSession, Db } from 'mongodb';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';
import { ContractRepository } from './ContractRepository.js';

export interface IContractPointerValue {
    pointer: Buffer;
    value: Buffer;
}

export class ContractPointerValueRepository extends ContractRepository {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getByContractAndPointer(
        contractAddress: string,
        pointer: Buffer,
        currentSession?: ClientSession,
    ): Promise<IContractPointerValue | null> {
        const bufA = this.bufferToUint8Array(pointer);
        const pointerToBinary = new Binary(bufA);

        const criteria: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
        };

        const results = await this.queryOnePartial(criteria, currentSession);
        if (results === null) {
            return null;
        }

        return {
            pointer: Buffer.from(results.pointer.buffer),
            value: Buffer.from(results.value.buffer),
        };
    }

    private bufferToUint8Array(buffer: Buffer): Uint8Array {
        const arrayBuffer = new ArrayBuffer(buffer.length);

        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < buffer.length; ++i) {
            view[i] = buffer[i];
        }

        return view;
    }

    public async setByContractAndPointer(
        contractAddress: string,
        pointer: Buffer,
        value: Buffer,
        currentSession?: ClientSession,
    ): Promise<void> {
        const bufPointer = this.bufferToUint8Array(pointer);
        const bufValue = this.bufferToUint8Array(value);

        const pointerToBinary = new Binary(bufPointer);
        const valueToBinary = new Binary(bufValue);

        const criteria: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
        };

        const update: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
            value: valueToBinary,
        };

        await this.updateOne(criteria, update, currentSession);
    }
}
