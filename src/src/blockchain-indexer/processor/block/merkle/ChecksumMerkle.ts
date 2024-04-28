import { BufferHelper } from '@btc-vision/bsi-binary';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { BlockHeaderChecksumProof } from '../../../../db/interfaces/IBlockHeaderBlockDocument.js';

export class ChecksumMerkle {
    public static TREE_TYPE: [string, string] = ['uint8', 'bytes32'];
    protected tree: StandardMerkleTree<[number, Uint8Array]> | undefined;
    private values: [number, Uint8Array][] = [];

    constructor() {}

    public get root(): string {
        if (!this.tree) {
            throw new Error('[Checksum] Merkle tree not generated (Get root)');
        }

        return this.tree.root;
    }

    public static verify(
        root: string,
        type: [string, string],
        value: [number, Uint8Array],
        proof: string[],
    ): boolean {
        return StandardMerkleTree.verify<[number, Uint8Array]>(root, type, value, proof);
    }

    public validate(): void {
        if (!this.tree) {
            throw new Error('[Checksum] Merkle tree not generated');
        }

        this.tree.validate();
    }

    public setBlockData(
        previousBlockHash: string,
        previousBlockChecksum: string,
        blockHash: string,
        blockMerkleRoot: string,
        blockStateRoot: string,
        blockReceiptRoot: string,
    ): void {
        this.values.push([0, BufferHelper.hexToUint8Array(previousBlockHash)]);
        this.values.push([1, BufferHelper.hexToUint8Array(previousBlockChecksum)]);
        this.values.push([2, BufferHelper.hexToUint8Array(blockHash)]);
        this.values.push([3, BufferHelper.hexToUint8Array(blockMerkleRoot)]);
        this.values.push([4, BufferHelper.hexToUint8Array(blockStateRoot)]);
        this.values.push([5, BufferHelper.hexToUint8Array(blockReceiptRoot)]);

        this.generateTree();
    }

    public getProofs(): BlockHeaderChecksumProof {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        this.validate();

        const proofs: BlockHeaderChecksumProof = [];
        for (let i = 0; i < this.values.length; i++) {
            const proof: string[] = this.tree.getProof(this.values[i]);

            if (!proof || !proof.length) {
                throw new Error(`Proof not found for ${this.values[i][0]}`);
            }

            proofs.push([this.values[i][0], proof]);
        }

        return proofs;
    }

    private generateTree(): void {
        if (this.tree) {
            throw new Error('Checksum Merkle tree already generated');
        }

        this.tree = StandardMerkleTree.of<[number, Uint8Array]>(
            this.values,
            ChecksumMerkle.TREE_TYPE,
            {
                sortLeaves: true,
            },
        );
    }
}
