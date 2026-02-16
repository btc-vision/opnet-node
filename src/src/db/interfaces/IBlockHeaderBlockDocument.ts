import { IBaseDocument } from '@btc-vision/bsi-common';
import { Decimal128, Long } from 'mongodb';

export type BlockHeaderChecksumProof = Array<[number, string[]]>;

export interface BaseBlockDocument {
    /** Allows us to verify that the block is correct and not regenerated. */
    checksumRoot: string;

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

    ema: bigint;
    baseGas: bigint;
    gasUsed: bigint;
}

export interface BlockHeaderDocument
    extends Omit<BaseBlockDocument, 'ema' | 'baseGas' | 'gasUsed'> {
    height: Decimal128;
    time: Date;
    medianTime: Date;
    ema: number;
    baseGas: number;
    gasUsed: Long;
}

export interface BlockHeaderAPIBlockDocument
    extends Omit<BaseBlockDocument, 'ema' | 'baseGas' | 'gasUsed'> {
    height: string;

    time: number;
    medianTime: number;

    ema: string;
    baseGas: string;
    gasUsed: string;
}

export interface BlockHeader extends Omit<BlockHeaderAPIBlockDocument, 'height' | 'hash'> {
    readonly height: bigint;
    readonly hash: Uint8Array;
}

export type IBlockHeaderBlockDocument = BlockHeaderDocument & IBaseDocument;
