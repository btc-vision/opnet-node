import { BaseRepository } from '@btc-vision/bsi-common';
import { Binary, ClientSession, Collection, Db, Filter } from 'mongodb';
import { BufferHelper } from '../../utils/BufferHelper.js';
import { Address } from '../../vm/buffer/types/math.js';
import { MemoryValue } from '../../vm/storage/types/MemoryValue.js';
import { StoragePointer } from '../../vm/storage/types/StoragePointer.js';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';

export interface IContractPointerValue {
    pointer: StoragePointer;
    value: MemoryValue;
    proofs: string[];
    lastSeenAt: bigint;
}

export class ContractPointerValueRepository extends BaseRepository<IContractPointerValueDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getByContractAndPointer(
        contractAddress: Address,
        pointer: StoragePointer,
        height?: bigint,
        currentSession?: ClientSession,
    ): Promise<IContractPointerValue | null> {
        const pointerToBinary = new Binary(pointer);
        const criteria: Partial<Filter<IContractPointerValueDocument>> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
        };

        if (height) {
            /** Allow block to be rescanned */
            criteria.lastSeenAt = { $lt: BufferHelper.toDecimal128(height) };
        }

        const results = await this.queryOne(criteria, currentSession);
        if (results === null) {
            return null;
        }

        if (!results.pointer || !results.value || !results.proofs || !results.lastSeenAt) {
            this.error(`[DATABASE CORRUPTION.] Invalid pointer value.`);
            throw new Error(`[DATABASE CORRUPTION.] Invalid pointer value.`);
        }

        return {
            pointer: BufferHelper.bufferToUint8Array(results.pointer.value()),
            value: BufferHelper.bufferToUint8Array(results.value.value()),
            proofs: results.proofs,
            lastSeenAt: BufferHelper.fromDecimal128(results.lastSeenAt),
        };
    }

    public async setByContractAndPointer(
        contractAddress: Address,
        bufPointer: StoragePointer,
        bufValue: MemoryValue,
        proofs: string[],
        lastSeenAt: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const pointerToBinary = new Binary(bufPointer);
        const valueToBinary = new Binary(bufValue);

        const criteria: Partial<Filter<IContractPointerValueDocument>> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
            lastSeenAt: BufferHelper.toDecimal128(lastSeenAt),
        };

        const update: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
            value: valueToBinary,
            proofs: proofs,
            lastSeenAt: BufferHelper.toDecimal128(lastSeenAt),
        };

        await this.updatePartial(criteria, update, currentSession);
    }

    protected override getCollection(): Collection<IContractPointerValueDocument> {
        return this._db.collection('InternalPointers');
    }
}
