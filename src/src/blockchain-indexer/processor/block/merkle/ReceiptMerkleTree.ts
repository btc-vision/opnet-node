import { BTC_FAKE_ADDRESS, MAX_HASH, MAX_MINUS_ONE } from '../types/ZeroValue.js';
import { Address, AddressMap, BinaryWriter } from '@btc-vision/transaction';
import { MerkleTree } from './MerkleTree.js';
import { FastStringMap } from '../../../../utils/fast/FastStringMap.js';
import { fromHex, toHex } from '@btc-vision/bitcoin';

export class ReceiptMerkleTree extends MerkleTree<string, Uint8Array> {
    public toBytes(values: Uint8Array[]): Uint8Array {
        const writer = new BinaryWriter(32 * values.length);
        for (const value of values) {
            writer.writeBytes(value);
        }

        return writer.getBuffer();
    }

    public getProofs(): AddressMap<FastStringMap<string[]>> {
        const proofs = new AddressMap<FastStringMap<string[]>>();
        for (const [address, val] of this.values) {
            for (const [key, value] of val.entries()) {
                const transactionBuf = fromHex(key);
                const proof: string[] = this.getProofHashes([transactionBuf, value]);

                if (!proof || !proof.length) {
                    throw new Error(`Proof not found for ${key}`);
                }

                if (!proofs.has(address)) {
                    proofs.set(address, new FastStringMap());
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
    public updateValues(address: Address, val: FastStringMap<Uint8Array>): void {
        this.ensureAddress(address);

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        // Local flag for this call
        let valueChanged = false;

        for (const [key, value] of val.entries()) {
            const currentValue = map.get(key);
            // If the value is unchanged, skip
            if (currentValue && currentValue === value) {
                continue;
            }

            // A real change occurred
            map.set(key, value);
            valueChanged = true;
        }

        this.valueChanged = this.valueChanged || valueChanged;
    }

    public updateValue(contractAddress: Address, transactionId: string, result: Uint8Array): void {
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

        map.set(transactionId, new Uint8Array(result));
        this.valueChanged = true;
    }

    public getValue(address: Address, key: string): Uint8Array | undefined {
        if (!this.values.has(address)) {
            return;
        }

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        return map.get(key);
    }

    public getValueWithProofs(address: Address, key: string): [Uint8Array, string[]] | undefined {
        if (!this._tree) {
            return;
        }

        const keyBuf = fromHex(key);
        const value = this.getValue(address, key);
        if (value == undefined) {
            return undefined;
        }

        const proof: string[] = this.getProofHashes([keyBuf, value]);
        if (!proof || !proof.length) {
            throw new Error(`Proof not found for ${toHex(keyBuf)}`);
        }

        return [value, proof];
    }

    public getValuesWithProofs(address: Address): FastStringMap<[Uint8Array, string[]]> {
        const proofs = new FastStringMap<[Uint8Array, string[]]>();
        if (!this.values.has(address)) {
            return proofs;
        }

        const map = this.values.get(address);
        if (!map) {
            throw new Error('Map not found');
        }

        for (const [key, value] of map.entries()) {
            const keyBuf = fromHex(key);
            const proof: string[] = this.getProofHashes([keyBuf, value]);

            if (!proof || !proof.length) {
                throw new Error(`Proof not found for ${key}`);
            }

            proofs.set(key, [value, proof]);
        }

        return proofs;
    }

    public getEverythingWithProofs():
        | AddressMap<FastStringMap<[Uint8Array, string[]]>>
        | undefined {
        if (!this._tree) {
            return;
        }

        const proofs = new AddressMap<FastStringMap<[Uint8Array, string[]]>>();
        for (const address of this.values.keys()) {
            const map = this.getValuesWithProofs(address);

            proofs.set(address, map);
        }

        return proofs;
    }

    public getValues(): [Uint8Array, Uint8Array][] {
        const entries: [Uint8Array, Uint8Array][] = [];

        for (const map of this.values.values()) {
            for (const [key, value] of map.entries()) {
                const keyBuf = fromHex(key);

                entries.push([keyBuf, value]);
            }
        }

        return entries;
    }

    protected getDummyValues(): AddressMap<FastStringMap<Uint8Array>> {
        const dummyValues = new AddressMap<FastStringMap<Uint8Array>>();
        const dummyMap = new FastStringMap<Uint8Array>();

        // Ensure minimum tree requirements
        dummyMap.set(MAX_HASH, new Uint8Array([1]));
        dummyMap.set(MAX_MINUS_ONE, new Uint8Array([1]));

        // Add dummy values for the contract
        dummyValues.set(BTC_FAKE_ADDRESS, dummyMap);

        return dummyValues;
    }

    private ensureAddress(address: Address): void {
        if (!this.values.has(address)) {
            this.values.set(address, new Map());
        }
    }
}
