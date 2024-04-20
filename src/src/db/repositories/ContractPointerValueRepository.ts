import { BaseRepository } from '@btc-vision/bsi-common';
import { Binary, ClientSession, Collection, Db, Filter } from 'mongodb';
import { BufferHelper } from '../../utils/BufferHelper.js';
import { MemoryValue } from '../../vm/storage/types/MemoryValue.js';
import { StoragePointer } from '../../vm/storage/types/StoragePointer.js';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';

export interface IContractPointerValue {
    pointer: StoragePointer;
    value: MemoryValue;
}

export class ContractPointerValueRepository extends BaseRepository<IContractPointerValueDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getByContractAndPointer(
        contractAddress: string,
        pointer: StoragePointer,
        currentSession?: ClientSession,
    ): Promise<IContractPointerValue | null> {
        const pointerToBinary = new Binary(pointer);

        const criteria: Partial<Filter<IContractPointerValueDocument>> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
        };

        const results = await this.queryOne(criteria, currentSession);
        if (results === null) {
            return null;
        }

        return {
            pointer: BufferHelper.bufferToUint8Array(results.pointer.value()),
            value: BufferHelper.bufferToUint8Array(results.value.value()),
        };
    }

    public async setByContractAndPointer(
        contractAddress: string,
        bufPointer: StoragePointer,
        bufValue: MemoryValue,
        currentSession?: ClientSession,
    ): Promise<void> {
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
