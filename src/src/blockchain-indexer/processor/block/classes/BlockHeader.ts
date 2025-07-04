import { BlockDataWithTransactionData } from '@btc-vision/bitcoin-rpc';

export type BlockDataWithoutTransactionData = Omit<BlockDataWithTransactionData, 'tx'>;

export class BlockHeader {
    public hash: string;
    public readonly height: bigint;

    public readonly confirmations: number;

    public readonly version: number;
    public readonly versionHex: string;

    public readonly size: number;
    public readonly strippedSize: number;
    public readonly weight: number;
    public readonly merkleRoot: string;

    public readonly time: Date;
    public readonly medianTime: Date;

    public readonly nonce: number;
    public readonly bits: string;

    public readonly difficulty: number;
    public readonly chainWork: string;

    public nTx: number;
    public readonly previousBlockHash: string;

    private readonly raw: BlockDataWithoutTransactionData & { tx: undefined };

    constructor(rawBlockData: BlockDataWithoutTransactionData) {
        this.hash = rawBlockData.hash;
        this.height = BigInt(rawBlockData.height);
        this.confirmations = rawBlockData.confirmations;
        this.version = rawBlockData.version;
        this.versionHex = rawBlockData.versionHex;
        this.size = rawBlockData.size;
        this.strippedSize = rawBlockData.strippedsize;
        this.weight = rawBlockData.weight;
        this.merkleRoot = rawBlockData.merkleroot;

        this.time = new Date(rawBlockData.time * 1000);
        this.medianTime = new Date(rawBlockData.mediantime * 1000);

        this.nonce = rawBlockData.nonce;
        this.bits = rawBlockData.bits;
        this.difficulty = rawBlockData.difficulty;
        this.chainWork = rawBlockData.chainwork;

        this.nTx =
            (rawBlockData.nTx ?? (rawBlockData as BlockDataWithTransactionData).tx)
                ? (rawBlockData as BlockDataWithTransactionData).tx?.length || 0
                : 0;

        this.previousBlockHash = rawBlockData.previousblockhash;

        this.raw = {
            ...rawBlockData,
            tx: undefined,
        };
    }

    public toJSON(): BlockDataWithoutTransactionData {
        return this.raw;
    }
}
