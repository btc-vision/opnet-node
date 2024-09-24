import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../db/interfaces/IBlockHeaderBlockDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { ZERO_HASH } from '../blockchain-indexer/processor/block/types/ZeroValue.js';
import { IBtcIndexerConfig } from '../config/interfaces/IBtcIndexerConfig.js';
import { VMStorage } from './storage/VMStorage.js';
import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import {BufferHelper} from "@btc-vision/bsi-binary";
import {ChecksumMerkle} from "../blockchain-indexer/processor/block/merkle/ChecksumMerkle.js";

export class BlockHeaderValidator extends Logger {
    public readonly logColor: string = '#00ff66';

    private cachedBlockHeader: Map<bigint, BlockHeaderBlockDocument> = new Map();

    public constructor(
        private readonly config: IBtcIndexerConfig,
        private readonly vmStorage: VMStorage,
    ) {
        super();
    }

    public setLastBlockHeader(blockHeader: BlockHeaderBlockDocument): void {
        this.cachedBlockHeader.set(DataConverter.fromDecimal128(blockHeader.height), blockHeader);
    }

    public clear(): void {
        this.cachedBlockHeader.clear();
    }

    public async getBlockHeader(height: bigint): Promise<BlockHeaderBlockDocument | undefined> {
        if (this.cachedBlockHeader.has(height)) {
            return this.cachedBlockHeader.get(height);
        }

        const blockHeader: BlockHeaderBlockDocument | undefined =
            await this.vmStorage.getBlockHeader(height);

        if (blockHeader) {
            this.cachedBlockHeader.set(height, blockHeader);
        }

        return blockHeader;
    }

    public async getPreviousBlockChecksumOfHeight(height: bigint): Promise<string | undefined> {
        const newBlockHeight: bigint = height - 1n;
        if (newBlockHeight < BigInt(this.config.OP_NET.ENABLED_AT_BLOCK)) {
            return ZERO_HASH;
        }

        const blockRootStates: BlockHeaderBlockDocument | undefined =
            await this.getBlockHeader(newBlockHeight);

        if (!blockRootStates) {
            return;
        }

        if (!blockRootStates.checksumRoot) {
            throw new Error('Invalid previous block checksum.');
        }

        return blockRootStates.checksumRoot;
    }

    /** TODO: Move this method to an other class and use this method when synchronizing block headers once PoA is implemented. */
    public async validateBlockChecksum(
        blockHeader: Partial<BlockHeaderBlockDocument>,
    ): Promise<boolean> {
        if (!blockHeader.checksumRoot || blockHeader.height === undefined) {
            throw new Error('Block checksum not found');
        }

        const prevBlockHash: string | undefined = blockHeader.previousBlockHash;
        const prevBlockChecksum: string | undefined = blockHeader.previousBlockChecksum;

        const blockHeight: bigint = DataConverter.fromDecimal128(blockHeader.height);
        const blockReceipt: string | undefined = blockHeader.receiptRoot;
        const blockStorage: string | undefined = blockHeader.storageRoot;
        const blockHash: string | undefined = blockHeader.hash;
        const blockMerkelRoot: string | undefined = blockHeader.merkleRoot;
        const checksumRoot: string | undefined = blockHeader.checksumRoot;
        const proofs: BlockHeaderChecksumProof | undefined = blockHeader.checksumProofs;

        if (
            blockHeight === null ||
            blockHeight === undefined ||
            !blockReceipt ||
            !blockStorage ||
            !blockHash ||
            !blockMerkelRoot ||
            !proofs ||
            !checksumRoot
        ) {
            throw new Error('Block data not found');
        }

        const previousBlockChecksum: string | undefined =
            await this.getPreviousBlockChecksumOfHeight(blockHeight);

        if (!previousBlockChecksum) {
            throw new Error('Previous block checksum not found');
        }

        if (prevBlockChecksum !== previousBlockChecksum) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.fail(
                    `Previous block checksum mismatch for block ${blockHeight} (${prevBlockChecksum} !== ${previousBlockChecksum})`,
                );
            }

            return false;
        }

        /** We must validate the block checksum */
        const prevHashValue: [number, Uint8Array] = [
            0,
            prevBlockHash ? BufferHelper.hexToUint8Array(prevBlockHash) : new Uint8Array(32),
        ];

        const prevHashProof = this.getProofForIndex(proofs, 0);
        const hasValidPrevHash: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            prevHashValue,
            prevHashProof,
        );

        const prevChecksumProof = this.getProofForIndex(proofs, 1);
        const hasValidPrevChecksum: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [1, BufferHelper.hexToUint8Array(previousBlockChecksum)],
            prevChecksumProof,
        );

        const blockHashProof = this.getProofForIndex(proofs, 2);
        const hasValidBlockHash: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [2, BufferHelper.hexToUint8Array(blockHash)],
            blockHashProof,
        );

        const blockMerkelRootProof = this.getProofForIndex(proofs, 3);
        const hasValidBlockMerkelRoot: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [3, BufferHelper.hexToUint8Array(blockMerkelRoot)],
            blockMerkelRootProof,
        );

        const blockStorageProof = this.getProofForIndex(proofs, 4);
        const hasValidBlockStorage: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [4, BufferHelper.hexToUint8Array(blockStorage)],
            blockStorageProof,
        );

        const blockReceiptProof = this.getProofForIndex(proofs, 5);
        const hasValidBlockReceipt: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [5, BufferHelper.hexToUint8Array(blockReceipt)],
            blockReceiptProof,
        );

        return (
            hasValidPrevHash &&
            hasValidPrevChecksum &&
            hasValidBlockHash &&
            hasValidBlockMerkelRoot &&
            hasValidBlockStorage &&
            hasValidBlockReceipt
        );
    }

    private getProofForIndex(proofs: BlockHeaderChecksumProof, index: number): string[] {
        for (const proof of proofs) {
            if (proof[0] === index) {
                return proof[1];
            }
        }

        throw new Error(`Proof not found for index ${index}`);
    }
}