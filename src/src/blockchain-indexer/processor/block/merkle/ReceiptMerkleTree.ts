import { Address } from '@btc-vision/bsi-binary';
import { MerkleTree } from './MerkleTree.js';
import { MAX_HASH, MAX_MINUS_ONE } from '../types/ZeroValue.js';

export class ReceiptMerkleTree extends MerkleTree<string, Buffer> {
    public static TREE_TYPE: [string, string] = ['bytes', 'bytes'];

    constructor() {
        super(ReceiptMerkleTree.TREE_TYPE);
    }

    public getProofs(): Map<Address, Map<string, string[]>> {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        this.validate();

        const proofs = new Map<Address, Map<string, string[]>>();
        for (const [address, val] of this.values.entries()) {
            for (const [key, value] of val.entries()) {
                const transactionBuf = Buffer.from(key, 'hex');
                const proof: string[] = this.tree.getProof([transactionBuf, value]);

                if (!proof || !proof.length) {
                    throw new Error(`Proof not found for ${key}`);
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
    public updateValues(address: Address, val: Map<string, Buffer>): void {
        this.ensureAddress(address);

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        let valueChanged: boolean = false;
        for (const [key, value] of val.entries()) {
            const currentValue = map.get(key);
            if (currentValue && currentValue === value) {
                continue;
            }

            map.set(key, value);
            valueChanged = true;
        }

        this.valueChanged = valueChanged;
    }

    public updateValue(contractAddress: string, transactionId: string, result: Uint8Array): void {
        if (this.frozen) {
            throw new Error('Merkle tree is frozen, cannot update value');
        }

        this.ensureAddress(contractAddress);

        const map = this.values.get(contractAddress);
        if (!map) {
            throw new Error('Map not found');
        }

        const currentValue = map.get(transactionId);
        if (currentValue && currentValue === result) {
            return;
        }

        map.set(transactionId, Buffer.from(result));
        this.valueChanged = true;
    }

    public getValue(address: string, key: string): Buffer | undefined {
        if (!this.values.has(address)) {
            return;
        }

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        return map.get(key);
    }

    public getValueWithProofs(address: string, key: string): [Buffer, string[]] | undefined {
        if (!this.tree) {
            return;
        }

        this.validate();

        const keyBuf = Buffer.from(key, 'hex');
        const value = this.getValue(address, key);
        if (!value) {
            return undefined;
        }

        const proof: string[] = this.tree.getProof([keyBuf, value]);
        if (!proof || !proof.length) {
            throw new Error(`Proof not found for ${keyBuf.toString('hex')}`);
        }

        return [value, proof];
    }

    public getValuesWithProofs(address: string): Map<string, [Buffer, string[]]> {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        this.validate();

        const proofs = new Map<string, [Buffer, string[]]>();
        if (!this.values.has(address)) {
            return proofs;
        }

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        for (const [key, value] of map.entries()) {
            const keyBuf = Buffer.from(key, 'hex');
            const proof: string[] = this.tree.getProof([keyBuf, value]);

            if (!proof || !proof.length) {
                throw new Error(`Proof not found for ${key}`);
            }

            proofs.set(key, [value, proof]);
        }

        return proofs;
    }

    public getEverythingWithProofs(): Map<string, Map<string, [Buffer, string[]]>> | undefined {
        if (!this.tree) {
            return;
        }

        this.validate();

        const proofs = new Map<string, Map<string, [Buffer, string[]]>>();
        for (const [address] of this.values.entries()) {
            const map = this.getValuesWithProofs(address);

            proofs.set(address, map);
        }

        return proofs;
    }

    public getValues(): [Buffer, Buffer][] {
        const entries: [Buffer, Buffer][] = [];

        for (const [_address, map] of this.values.entries()) {
            for (const [key, value] of map.entries()) {
                const keyBuf = Buffer.from(key, 'hex');

                entries.push([keyBuf, value]);
            }
        }

        return entries;
    }

    protected getDummyValues(): Map<string, Map<string, Buffer>> {
        const dummyValues = new Map<string, Map<string, Buffer>>();
        const dummyMap = new Map<string, Buffer>();

        // Ensure minimum tree requirements
        dummyMap.set(MAX_HASH, Buffer.from([1]));
        dummyMap.set(MAX_MINUS_ONE, Buffer.from([1]));

        // Add dummy values for the contract
        dummyValues.set(MAX_MINUS_ONE, dummyMap);

        return dummyValues;
    }

    private ensureAddress(address: Address): void {
        if (!this.values.has(address)) {
            this.values.set(address, new Map());
        }
    }
}
