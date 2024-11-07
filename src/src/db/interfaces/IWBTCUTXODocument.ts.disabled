import { Binary, Decimal128 } from 'mongodb';

export interface IWBTCUTXODocument {
    readonly vault: string;
    readonly blockId: Decimal128;

    readonly hash: string;
    readonly value: Decimal128;
    readonly outputIndex: number;

    readonly output: Binary;

    readonly spent: boolean;
    readonly spentAt: Decimal128 | null;
}

export interface PartialWBTCUTXODocument {
    readonly vault: string;

    readonly hash: string;
    readonly value: Decimal128;
    readonly outputIndex: number;

    readonly output: Binary;
}

export interface PartialWBTCUTXODocumentForAPI
    extends Omit<PartialWBTCUTXODocument, 'value' | 'output'> {
    readonly output: string;
    readonly value: string;
}

export interface IUsedWBTCUTXODocument {
    readonly vault: string;
    readonly height: Decimal128;
    readonly hash: string;
    readonly outputIndex: number;
}

export interface UsedUTXOToDelete {
    readonly hash: string;
    readonly outputIndex: number;
}
