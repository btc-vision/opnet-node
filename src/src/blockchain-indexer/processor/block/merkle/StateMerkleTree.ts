import crypto from 'crypto';
import { BufferHelper } from '../../../../utils/BufferHelper.js';
import { Address, MemorySlotData, MemorySlotPointer } from '../../../../vm/buffer/types/math.js';
import { MerkleTree } from './MerkleTree.js';

export class StateMerkleTree extends MerkleTree<MemorySlotPointer, MemorySlotData<bigint>> {
    public static TREE_TYPE: [string, string] = ['bytes32', 'bytes32'];

    constructor() {
        super(StateMerkleTree.TREE_TYPE);
    }

    public getProofs(): Map<Address, Map<MemorySlotPointer, string[]>> {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        this.validate();

        const proofs = new Map<Address, Map<MemorySlotPointer, string[]>>();
        for (const [address, val] of this.values.entries()) {
            for (const [key, value] of val.entries()) {
                const pointer = this.encodePointer(address, key);
                const valueAsBuffer = Buffer.from(BufferHelper.valueToUint8Array(value));

                const proof: string[] = this.tree.getProof([pointer, valueAsBuffer]);

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
    public updateValues(
        address: Address,
        val: Map<MemorySlotPointer, MemorySlotData<bigint>>,
    ): void {
        if (!this.values.has(address)) {
            this.values.set(address, new Map());
        }

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        for (const [key, value] of val.entries()) {
            map.set(key, value);
        }
    }

    protected getValues(): [Buffer, Buffer][] {
        const entries: [Buffer, Buffer][] = [];

        for (const [address, map] of this.values.entries()) {
            for (const [key, value] of map.entries()) {
                const pointer = this.encodePointer(address, key);
                const valueAsBuffer = Buffer.from(BufferHelper.valueToUint8Array(value));

                entries.push([pointer, valueAsBuffer]);
            }
        }

        return entries;
    }

    private encodePointer(contract: string, pointer: bigint): Buffer {
        const hash = crypto.createHash('sha256');
        hash.update(contract);
        hash.update(BufferHelper.pointerToUint8Array(pointer));

        return hash.digest();
    }
}
