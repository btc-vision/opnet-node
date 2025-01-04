import { MerkleTree, toBytes } from './MerkleTree.js';
import {
    Address,
    AddressMap,
    BinaryWriter,
    BufferHelper,
    MemorySlotData,
    MemorySlotPointer,
} from '@btc-vision/transaction';
import { MerkleProof, MerkleTree as MerkleTreeRust } from '@btc-vision/rust-merkle-tree';
import { FastBigIntMap } from '../../../../utils/fast/FastBigintMap.js';

export class StateMerkleTree extends MerkleTree<MemorySlotPointer, MemorySlotData<bigint>> {
    public static verify(root: string, values: Buffer[] | Uint8Array[], proof: string[]): boolean {
        const writer = new BinaryWriter(32 * values.length);
        for (const value of values) {
            writer.writeBytes(value);
        }

        const data = writer.getBuffer();
        return new MerkleProof(proof.map((p) => toBytes(p))).verify(
            toBytes(root),
            MerkleTreeRust.hash(data),
        );
    }

    public toBytes(values: Buffer[]): Uint8Array {
        const writer = new BinaryWriter(32 * values.length);
        for (const value of values) {
            writer.writeBytes(value);
        }

        return writer.getBuffer();
    }

    public getProofs(): AddressMap<Map<MemorySlotPointer, string[]>> {
        const proofs = new AddressMap<Map<MemorySlotPointer, string[]>>();
        for (const [address, val] of this.values) {
            for (const [key, value] of val.entries()) {
                const pointer = this.encodePointer(key);
                const valueAsBuffer = Buffer.from(BufferHelper.valueToUint8Array(value));

                const proof: string[] = this.getProofHashes([pointer, valueAsBuffer]);
                if (!proof || !proof.length) {
                    throw new Error(`Proof not found for ${pointer.toString('hex')}`);
                }

                if (!proofs.has(address)) {
                    proofs.set(address, new Map());
                }

                const proofMap = proofs.get(address);
                if (proofMap) {
                    proofMap.set(key, proof);
                }
            }
        }

        return proofs;
    }

    /** We have to replace the value of the given address and key with the new value */
    public updateValues(address: Address, val: FastBigIntMap): void {
        this.ensureAddress(address);

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        let valueChanged: boolean = false;
        for (const [key, value] of val) {
            const currentValue = map.get(key);
            if (currentValue && currentValue === value) {
                continue;
            }

            map.set(key, value);
            valueChanged = true;
        }

        this.valueChanged = valueChanged;
    }

    public updateValue(
        address: Address,
        key: MemorySlotPointer,
        val: MemorySlotData<bigint>,
    ): void {
        if (this.frozen) {
            throw new Error('Merkle tree is frozen, cannot update value');
        }

        this.ensureAddress(address);

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        const currentValue = map.get(key);
        if (currentValue && currentValue === val) {
            return;
        }

        map.set(key, val);
        this.valueChanged = true;
    }

    public getValue(address: Address, key: MemorySlotPointer): MemorySlotData<bigint> | undefined {
        if (!this.values.has(address)) {
            return;
        }

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        return map.get(key);
    }

    public getValueWithProofs(
        address: Address,
        key: MemorySlotPointer,
    ): [Uint8Array, string[]] | undefined {
        const value = this.getValue(address, key);
        if (!value) {
            return undefined;
        }

        const uint8Array = BufferHelper.valueToUint8Array(value);
        const valueAsBuffer = Buffer.from(uint8Array);
        const pointer = this.encodePointer(key);

        if (!this._tree) {
            return [uint8Array, []];
        }

        const proof: string[] = this.getProofHashes([pointer, valueAsBuffer]);
        if (!proof || !proof.length) {
            throw new Error(`Proof not found for ${pointer.toString('hex')}`);
        }

        return [uint8Array, proof];
    }

    public getValuesWithProofs(
        address: Address,
    ): Map<MemorySlotPointer, [MemorySlotData<bigint>, string[]]> {
        const proofs = new Map<MemorySlotPointer, [MemorySlotData<bigint>, string[]]>();
        if (!this.values.has(address)) {
            return proofs;
        }

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        for (const [key, value] of map.entries()) {
            const pointer = this.encodePointer(key);
            const valueAsBuffer = Buffer.from(BufferHelper.valueToUint8Array(value));

            const proof: string[] = this.getProofHashes([pointer, valueAsBuffer]);

            if (!proof || !proof.length) {
                throw new Error(`Proof not found for pointer ${pointer.toString('hex')}`);
            }

            proofs.set(key, [value, proof]);
        }

        return proofs;
    }

    public getEverythingWithProofs():
        | AddressMap<Map<MemorySlotPointer, [MemorySlotData<bigint>, string[]]>>
        | undefined {
        if (!this._tree) {
            return;
        }

        const proofs = new AddressMap<Map<MemorySlotPointer, [MemorySlotData<bigint>, string[]]>>();
        for (const address of this.values.keys()) {
            const map = this.getValuesWithProofs(address);

            proofs.set(address, map);
        }

        return proofs;
    }

    public encodePointer(pointer: bigint): Buffer {
        return Buffer.from(BufferHelper.pointerToUint8Array(pointer));
    }

    public getValues(): [Buffer, Buffer][] {
        const entries: [Buffer, Buffer][] = [];

        for (const map of this.values.values()) {
            for (const [key, value] of map.entries()) {
                const pointer = this.encodePointer(key);
                const valueAsBuffer = Buffer.from(BufferHelper.valueToUint8Array(value));

                entries.push([pointer, valueAsBuffer]);
            }
        }

        return entries;
    }

    protected getDummyValues(): AddressMap<Map<MemorySlotPointer, MemorySlotData<bigint>>> {
        const dummyValues = new AddressMap<Map<MemorySlotPointer, MemorySlotData<bigint>>>();
        const dummyMap = new Map<MemorySlotPointer, MemorySlotData<bigint>>();

        // Ensure minimum tree requirements
        dummyMap.set(1n, 1n);
        dummyMap.set(2n, 2n);

        // Add dummy values for the contract
        dummyValues.set(MerkleTree.DUMMY_ADDRESS_NON_EXISTENT, dummyMap);

        return dummyValues;
    }

    private ensureAddress(address: Address): void {
        if (!this.values.has(address)) {
            this.values.set(address, new Map());
        }
    }
}
