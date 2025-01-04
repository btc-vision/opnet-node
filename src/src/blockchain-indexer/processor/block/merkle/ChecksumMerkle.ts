import { BinaryWriter, BufferHelper } from '@btc-vision/transaction';
import { ZERO_HASH } from '../types/ZeroValue.js';
import { MerkleProof, MerkleTree } from '@btc-vision/rust-merkle-tree';
import { BlockHeaderChecksumProof } from '../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { toBytes } from './MerkleTree.js';

export class ChecksumMerkle {
    public tree: MerkleTree | undefined;
    public values: [number, Uint8Array][] = [];

    public get root(): string {
        if (!this.tree) {
            throw new Error('[Checksum] Merkle tree not generated (Get root)');
        }

        return this.tree.rootHex();
    }

    public static toBytes(value: [number, Uint8Array]): Uint8Array {
        const writer = new BinaryWriter(1 + value[1].length);
        writer.writeU8(value[0]);
        writer.writeBytes(value[1]);

        return writer.getBuffer();
    }

    public static verify(root: Uint8Array, values: [number, Uint8Array], proof: string[]): boolean {
        const generatedProof = new MerkleProof(proof.map((p) => toBytes(p)));
        return generatedProof.verify(root, MerkleTree.hash(ChecksumMerkle.toBytes(values)));
    }

    public setBlockData(
        previousBlockHash: string,
        previousBlockChecksum: string,
        blockHash: string,
        blockMerkleRoot: string,
        blockStateRoot: string,
        blockReceiptRoot: string,
    ): void {
        this.values.push([0, BufferHelper.hexToUint8Array(previousBlockHash || ZERO_HASH)]);
        this.values.push([1, BufferHelper.hexToUint8Array(previousBlockChecksum || ZERO_HASH)]);
        this.values.push([2, BufferHelper.hexToUint8Array(blockHash || ZERO_HASH)]);
        this.values.push([3, BufferHelper.hexToUint8Array(blockMerkleRoot || ZERO_HASH)]);
        this.values.push([4, BufferHelper.hexToUint8Array(blockStateRoot || ZERO_HASH)]);
        this.values.push([5, BufferHelper.hexToUint8Array(blockReceiptRoot || ZERO_HASH)]);

        this.generateTree();
    }

    public getProofs(): BlockHeaderChecksumProof {
        if (!this.tree) {
            throw new Error('Merkle tree not generated');
        }

        const result: BlockHeaderChecksumProof = [];
        const hashes = this.tree.hashes();

        for (let i = 0; i < hashes.length; i++) {
            const hash = hashes[i];
            result.push([
                Number(i),
                this.tree.getProof(this.tree.getIndexHash(hash)).proofHashesHex(),
            ]);
        }

        return result;
    }

    private generateTree(): void {
        this.tree = new MerkleTree(
            this.values.map((v) => ChecksumMerkle.toBytes(v)),
            true,
        );
    }
}
