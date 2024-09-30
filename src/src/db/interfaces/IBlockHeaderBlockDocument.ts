import { IBaseDocument } from '@btc-vision/bsi-common';
import { Decimal128 } from 'mongodb';

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
}

export interface BlockHeaderBlockDocument extends Omit<BaseBlockDocument, 'ema' | 'baseGas'> {
    height: Decimal128;
    time: Date;
    medianTime: Date;
    ema: number;
    baseGas: number;
}

export interface BlockHeaderAPIBlockDocument extends Omit<BaseBlockDocument, 'ema' | 'baseGas'> {
    height: string;

    time: number;
    medianTime: number;

    ema: string;
    baseGas: string;
}

export type IBlockHeaderBlockDocument = BlockHeaderBlockDocument & IBaseDocument;
