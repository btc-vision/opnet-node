import { Filter, Collection, Binary, ClientSession, Db } from 'mongodb';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';
import { BufferHelper } from '../../utils/BufferHelper.js';
import { BaseRepository } from '@btc-vision/motoswapcommon';

export interface IContractPointerValue {
    pointer: Buffer;
    value: Buffer;
}

export class ContractPointerValueRepository extends BaseRepository<IContractPointerValueDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getByContractAndPointer(
        contractAddress: string,
        pointer: Buffer,
        currentSession?: ClientSession,
    ): Promise<IContractPointerValue | null> {
        const bufA = BufferHelper.bufferToUint8Array(pointer);
        const pointerToBinary = new Binary(bufA);

        const criteria: Partial<Filter<IContractPointerValueDocument>> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
        };

        const results = await this.queryOne(criteria, currentSession);
        if (results === null) {
            return null;
        }

        return {
            pointer: Buffer.from(results.pointer.buffer),
            value: Buffer.from(results.value.buffer),
        };
    }

    public async setByContractAndPointer(
        contractAddress: string,
        pointer: Buffer,
        value: Buffer,
        currentSession?: ClientSession,
    ): Promise<void> {
        const bufPointer = BufferHelper.bufferToUint8Array(pointer);
        const bufValue = BufferHelper.bufferToUint8Array(value);

        const pointerToBinary = new Binary(bufPointer);
        const valueToBinary = new Binary(bufValue);

        const criteria: Partial<Filter<IContractPointerValueDocument>> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
        };

        const update: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
            value: valueToBinary,
        };

        await this.updatePartial(criteria, update, currentSession);
    }

    protected override getCollection(): Collection<IContractPointerValueDocument> {
        return this._db.collection('InternalPointers');
    }
}
