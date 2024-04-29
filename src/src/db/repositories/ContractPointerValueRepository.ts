import { Address, BufferHelper } from '@btc-vision/bsi-binary';
import { BaseRepository } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import {
    Binary,
    BulkWriteOptions,
    BulkWriteResult,
    ClientSession,
    Collection,
    Db,
    Filter,
} from 'mongodb';
import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';
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
            criteria.lastSeenAt = { $lt: DataConverter.toDecimal128(height) };
        }

        /** Sorting is VERY important. */
        const results: IContractPointerValueDocument | null = await this.queryOne(
            criteria,
            currentSession,
            { lastSeenAt: -1 },
        );

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
            lastSeenAt: DataConverter.fromDecimal128(results.lastSeenAt),
        };
    }

    public async setStoragePointers(
        storage: Map<BitcoinAddress, Map<StoragePointer, [MemoryValue, string[]]>>,
        lastSeenAt: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        if (!currentSession) {
            throw new Error('Current session is required.');
        }

        const bulk = this.getCollection().initializeUnorderedBulkOp();
        for (const [contractAddress, pointers] of storage) {
            for (const [pointer, [value, proofs]] of pointers) {
                const pointerToBinary = new Binary(pointer);
                const valueToBinary = new Binary(value);

                const criteria: Partial<Filter<IContractPointerValueDocument>> = {
                    contractAddress: contractAddress,
                    pointer: pointerToBinary,
                    lastSeenAt: DataConverter.toDecimal128(lastSeenAt),
                };

                const update: Partial<IContractPointerValueDocument> = {
                    contractAddress: contractAddress,
                    pointer: pointerToBinary,
                    value: valueToBinary,
                    proofs: proofs,
                    lastSeenAt: DataConverter.toDecimal128(lastSeenAt),
                };
                
                bulk.find(criteria).upsert().updateOne({ $set: update });
            }
        }

        const options: BulkWriteOptions = this.getOptions(currentSession);
        const response: BulkWriteResult = await bulk.execute(options);

        let errored = false;
        if (response.hasWriteErrors()) {
            const errors = response.getWriteErrors();

            for (const error of errors) {
                this.error(`[DATABASE ERROR.] ${error.errmsg}`);
            }

            errored = true;
        } else if (!response.isOk()) {
            errored = true;
        }

        if (errored) {
            this.error(`[DATABASE ERROR.] Bulk write operation failed.`);
            throw new Error(`[DATABASE ERROR.] Bulk write operation failed.`);
        }
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
            lastSeenAt: DataConverter.toDecimal128(lastSeenAt),
        };

        const update: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
            value: valueToBinary,
            proofs: proofs,
            lastSeenAt: DataConverter.toDecimal128(lastSeenAt),
        };

        await this.updatePartial(criteria, update, currentSession);
    }

    protected override getCollection(): Collection<IContractPointerValueDocument> {
        return this._db.collection('InternalPointers');
    }
}
