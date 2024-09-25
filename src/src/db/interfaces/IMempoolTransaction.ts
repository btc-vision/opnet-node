import { Binary, Decimal128, Long } from 'mongodb';
import { Address } from '@btc-vision/bsi-binary';

export interface IMempoolTransaction {
    readonly identifier: Binary;
    id?: string | null;

    readonly data: Binary;

    readonly psbt: boolean;
    readonly previousPsbtId?: string | null;

    readonly blockHeight: Decimal128;
    readonly firstSeen: Date | undefined;

    readonly inputs: {
        readonly transactionId: string;
        readonly outputIndex: number;
    }[];

    readonly outputs: {
        readonly data: Binary;
        readonly address: Address | null;
        readonly outputIndex: number;
        value: Long | number;
    }[];
}

export interface IMempoolTransactionObj
    extends Omit<
        IMempoolTransaction,
        'identifier' | 'data' | 'blockHeight' | 'outputs' | 'inputs'
    > {
    readonly identifier: bigint;
    readonly data: Buffer | Uint8Array;
    readonly blockHeight: bigint;

    readonly inputs: {
        readonly transactionId: string;
        readonly outputIndex: number;
    }[];

    readonly outputs: {
        readonly data: Buffer | Uint8Array;
        readonly address: Address | null;
        readonly outputIndex: number;
        value: Long;
    }[];
}
