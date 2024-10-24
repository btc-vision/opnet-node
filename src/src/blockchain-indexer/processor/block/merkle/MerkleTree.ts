import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { Address, AddressMap } from '@btc-vision/transaction';
import { BTC_FAKE_ADDRESS } from '../types/ZeroValue.js';

export abstract class MerkleTree<K, V> {
    public static readonly DUMMY_ADDRESS_NON_EXISTENT: Address = BTC_FAKE_ADDRESS;

    protected tree: StandardMerkleTree<[Buffer, Buffer]> | undefined;
    protected readonly values: AddressMap<Map<K, V>> = new AddressMap();

    protected valueChanged: boolean = false;
    protected frozen: boolean = false;
    private readonly MINIMUM_VALUES = 2; // To generate a tree, we need at least 2 values

    protected constructor(protected readonly treeType: [string, string]) {}

    public get root(): string {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        return this.tree.root;
    }

    public static verify(
        root: string,
        type: [string, string],
        value: Buffer[] | Uint8Array[],
        proof: string[],
    ): boolean {
        return StandardMerkleTree.verify(root, type, value, proof);
    }

    public size(): number {
        return this.values.size;
    }

    public validate(): void {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        if (this.countValues() < this.MINIMUM_VALUES) {
            throw new Error('Not enough values to generate a tree');
        }

        this.tree.validate();
    }

    public abstract getValue(address: Address, key: K): V | undefined;

    public abstract getValueWithProofs(
        address: Address,
        key: K,
    ): [V | Uint8Array, string[]] | undefined;

    public hasTree(): boolean {
        return !!this.tree;
    }

    public generateTree(regeneratedIfValueChanged: boolean = true): void {
        if (this.frozen) {
            throw new Error('Merkle tree is frozen');
        }

        if (!this.values.size) {
            return;
        }

        if (this.tree && !this.valueChanged && !regeneratedIfValueChanged) {
            return;
        }

        const values = this.getValues();
        this.tree = StandardMerkleTree.of<[Buffer, Buffer]>(values, this.treeType, {
            sortLeaves: true,
        });

        this.valueChanged = false;
    }

    public abstract getValuesWithProofs(address: Address): Map<K, [V, string[]]>;

    public abstract getEverythingWithProofs(): AddressMap<Map<K, [V, string[]]>> | undefined;

    public freeze(): void {
        if (this.countValues() < this.MINIMUM_VALUES) {
            // We will add two empty values to generate the tree

            const dummyValues = this.getDummyValues();
            for (const [address, map] of dummyValues) {
                if (!this.values.has(address)) {
                    this.values.set(address, map);
                } else {
                    const currentMap = this.values.get(address);
                    if (!currentMap) {
                        throw new Error('Map not found');
                    }

                    for (const [key, value] of map) {
                        if (!currentMap.has(key)) {
                            currentMap.set(key, value);
                        }
                    }
                }
            }
        }

        this.generateTree();

        this.frozen = true;
    }

    public abstract getProofs(): AddressMap<Map<K, string[]>>;

    public abstract updateValue(address: Address, key: K, val: V): void;

    public abstract updateValues(address: Address, val: Map<K, V>): void;

    public abstract getValues(): [Buffer, Buffer][];

    protected abstract getDummyValues(): AddressMap<Map<K, V>>;

    private countValues(): number {
        let count = 0;
        for (const [, map] of this.values) {
            count += map.size;
        }

        return count;
    }
}
