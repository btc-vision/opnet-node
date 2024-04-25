import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

export abstract class MerkleTree<K extends unknown, V extends unknown> {
    protected tree: StandardMerkleTree<[Buffer, Buffer]> | undefined;

    protected readonly values: Map<string, Map<K, V>> = new Map();

    protected constructor(protected readonly treeType: [string, string]) {}

    get root(): string {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        return this.tree.root;
    }

    public static verify(
        root: string,
        type: [string, string],
        value: Buffer[],
        proof: string[],
    ): boolean {
        return StandardMerkleTree.verify(root, type, value, proof);
    }

    public validate(): void {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        this.tree.validate();
    }

    public generateTree(): void {
        if (!this.values.size) {
            throw new Error('No values to generate tree');
        }

        const values = this.getValues();
        this.tree = StandardMerkleTree.of<[Buffer, Buffer]>(values, this.treeType);
    }

    public abstract getProofs(): Map<string, Map<K, string[]>>;

    public abstract updateValues(address: string, val: Map<K, V>): void;

    protected abstract getValues(): [Buffer, Buffer][];
}
