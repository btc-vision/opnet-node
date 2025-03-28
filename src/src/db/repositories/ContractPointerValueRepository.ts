import { Address, AddressMap, BufferHelper } from '@btc-vision/transaction';
import { BaseRepository } from '@btc-vision/bsi-common';
import {
    AnyBulkWriteOperation,
    Binary,
    BulkWriteOptions,
    ClientSession,
    Collection,
    Db,
    Filter,
    UpdateFilter,
} from 'mongodb';
import {
    MemoryValue,
    ProvenMemoryValue,
    ProvenPointers,
} from '../../vm/storage/types/MemoryValue.js';
import { StoragePointer } from '../../vm/storage/types/StoragePointer.js';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';
import { MerkleTree } from '../../blockchain-indexer/processor/block/merkle/MerkleTree.js';

export interface IContractPointerValue {
    pointer: StoragePointer;
    value: MemoryValue;
    proofs: string[];
    lastSeenAt: bigint;
}

export class ContractPointerValueRepository extends BaseRepository<IContractPointerValueDocument> {
    public readonly logColor: string = '#afeeee';

    public constructor(db: Db) {
        super(db);
    }

    public async deletePointerFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IContractPointerValueDocument>> = {
            lastSeenAt: { $gte: blockHeight },
        };

        await this.delete(criteria, currentSession);
    }

    public async getByContractsAndPointers(
        pointers: AddressMap<Uint8Array[]>,
        height?: bigint,
    ): Promise<ProvenPointers | null> {
        // If no pointers requested, return null immediately
        if (pointers.size === 0) {
            return null;
        }

        // Build a big OR clause for all (contractAddress, pointer) pairs
        const orArray: Record<string, unknown>[] = [];
        for (const [contractAddress, pointerList] of pointers) {
            const pointerBinaries = pointerList.map((ptr) => new Binary(ptr));
            const clause: Record<string, unknown> = {
                contractAddress: contractAddress,
                pointer: { $in: pointerBinaries },
            };

            if (typeof height !== 'undefined') {
                clause.lastSeenAt = { $lt: height };
            }

            orArray.push(clause);
        }

        // Combine them into one $match. If there's only one clause, just use it directly.
        const matchStage: Record<string, unknown> =
            orArray.length === 1 ? orArray[0] : { $or: orArray };

        // Build the aggregation pipeline
        //  - Match our criteria
        //  - Sort descending by lastSeenAt so the first doc per group is the most recent
        //  - Group by contractAddress & pointer, picking the top doc for each
        const pipeline = [
            { $match: matchStage },
            { $sort: { lastSeenAt: -1 } },
            {
                $group: {
                    _id: {
                        contractAddress: '$contractAddress',
                        pointer: '$pointer',
                    },
                    doc: { $first: '$$ROOT' },
                },
            },
        ];

        // Execute the pipeline
        const aggResults = await this.getCollection().aggregate(pipeline).toArray();

        // Initialize ProvenPointers with all requested pointers = null by default
        //         so that anything not found in the DB is explicitly null
        // (Adjust the exact shape of 'ProvenPointers' if your type signature differs.)
        const provenPointers: AddressMap<Map<Uint8Array, ProvenMemoryValue | null>> =
            new AddressMap();

        for (const [contractAddress, pointerList] of pointers) {
            // Initialize a fresh map for each contract
            const pointerMap = new Map<Uint8Array, ProvenMemoryValue | null>();
            for (const ptrU8 of pointerList) {
                pointerMap.set(ptrU8, null); // default to null unless found
            }

            provenPointers.set(contractAddress, pointerMap);
        }

        // Overwrite nulls with actual data for each doc found
        for (const result of aggResults) {
            const doc: IContractPointerValueDocument = (
                result as { doc: IContractPointerValueDocument }
            ).doc;

            const addressUint8Array = (doc.contractAddress as Binary).value();
            const addressObj = new Address(addressUint8Array);
            const pointerU8 = BufferHelper.bufferToUint8Array(doc.pointer.value());
            const valueU8 = BufferHelper.bufferToUint8Array(doc.value.value());

            // If we already have a map for this contract, update the pointer’s entry
            // (it should already be initialized to null)
            const pointerMap = provenPointers.get(addressObj);
            if (pointerMap) {
                pointerMap.set(pointerU8, {
                    value: valueU8,
                    proofs: doc.proofs,
                    lastSeenAt: BigInt(doc.lastSeenAt.toString()),
                });
            }
        }

        return provenPointers;
    }

    public async getByContractAndPointer(
        contractAddress: Address,
        pointer: StoragePointer,
        height?: bigint,
    ): Promise<IContractPointerValue | null> {
        const pointerToBinary = new Binary(pointer);
        const criteria: Partial<Filter<IContractPointerValueDocument>> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
        };

        if (typeof height !== 'undefined') {
            /** Allow block to be rescanned */
            criteria.lastSeenAt = { $lt: height };
        }

        /** Sorting is VERY important. */
        const results: IContractPointerValueDocument | null = await this.queryOne(
            criteria,
            undefined,
            { lastSeenAt: -1 },
        );

        if (results === null) {
            return null;
        }

        if (!results.pointer || !results.value || !results.proofs || !results.lastSeenAt) {
            this.error(`[DATABASE CORRUPTION] Invalid pointer value.`);
            throw new Error(`[DATABASE CORRUPTION] Invalid pointer value.`);
        }

        return {
            pointer: BufferHelper.bufferToUint8Array(results.pointer.value()),
            value: BufferHelper.bufferToUint8Array(results.value.value()),
            proofs: results.proofs,
            lastSeenAt: BigInt(results.lastSeenAt.toString()),
        };
    }

    public async setStoragePointers(
        storage: AddressMap<Map<StoragePointer, [MemoryValue, string[]]>>,
        lastSeenAt: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        if (!currentSession) {
            throw new Error('Current session is required.');
        }

        const MAX_OPERATIONS_PER_BATCH = 1000;
        const promises: Promise<void>[] = [];

        let operations: AnyBulkWriteOperation<IContractPointerValueDocument>[] = [];

        for (const [contractAddress, pointers] of storage) {
            if (contractAddress.equals(MerkleTree.DUMMY_ADDRESS_NON_EXISTENT)) {
                continue;
            }

            for (const [pointer, [value, proofs]] of pointers) {
                const pointerToBinary = new Binary(pointer);
                const valueToBinary = new Binary(value);

                const filter: Filter<IContractPointerValueDocument> = {
                    contractAddress: contractAddress,
                    pointer: pointerToBinary,
                    lastSeenAt: lastSeenAt,
                };

                const update: UpdateFilter<IContractPointerValueDocument> = {
                    $set: {
                        contractAddress: contractAddress,
                        pointer: pointerToBinary,
                        value: valueToBinary,
                        proofs: proofs,
                        lastSeenAt: lastSeenAt,
                    },
                };

                operations.push({
                    updateOne: {
                        filter: filter,
                        update: update,
                        upsert: true,
                    },
                });

                // Execute in batches
                if (operations.length >= MAX_OPERATIONS_PER_BATCH) {
                    promises.push(this.executeBulkWrite(operations, currentSession));
                    operations = [];
                }
            }
        }

        if (operations.length > 0) {
            promises.push(this.executeBulkWrite(operations, currentSession));
        }

        await Promise.safeAll(promises);
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
            lastSeenAt: lastSeenAt,
        };

        const update: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointerToBinary,
            value: valueToBinary,
            proofs: proofs,
            lastSeenAt: lastSeenAt,
        };

        await this.updatePartial(criteria, update, currentSession);
    }

    protected override getCollection(): Collection<IContractPointerValueDocument> {
        return this._db.collection('InternalPointers');
    }

    private async executeBulkWrite(
        operations: ReadonlyArray<AnyBulkWriteOperation<IContractPointerValueDocument>>,
        currentSession: ClientSession,
    ): Promise<void> {
        const options: BulkWriteOptions = this.getOptions(currentSession);
        options.ordered = true;

        const response = await this.getCollection().bulkWrite(operations, options);

        if (response.hasWriteErrors()) {
            const errors = response.getWriteErrors();
            for (const error of errors) {
                this.error(`[DATABASE ERROR.] ${error.errmsg}`);
            }
            throw new Error(`[DATABASE ERROR.] Bulk write operation failed.`);
        }
    }
}
