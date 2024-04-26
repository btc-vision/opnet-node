import { IBaseDocument } from '@btc-vision/bsi-common';
import { Decimal128 } from 'mongodb';

export type BlockHeaderChecksumProof = Array<[number, string[]]>;

export interface BlockHeaderBlockDocument {
    /** Allows us to verify that the block is correct and not regenerated. */
    checksumRoot: string;

    height: Decimal128;
    hash: string;

    previousBlockHash: string;
    previousBlockChecksum: string;

    bits: string;
    nonce: number;
    version: number;
    size: number;
    txCount: number;

    weight: number;
    strippedSize: number;

    merkleRoot: string;
    storageRoot: string;
    receiptRoot: string;

    checksumProofs: BlockHeaderChecksumProof;

    time: Date;
    medianTime: Date;
}

export type IBlockHeaderBlockDocument = IBaseDocument & BlockHeaderBlockDocument;
