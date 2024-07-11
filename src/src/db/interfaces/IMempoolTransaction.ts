import { Binary, Decimal128 } from 'mongodb';

export interface IMempoolTransaction {
    readonly identifier: Binary;
    id?: string | null;

    readonly data: Binary;

    readonly psbt: boolean;
    readonly previousPsbtId?: string | null;

    readonly blockHeight: Decimal128;
    readonly firstSeen: Date | undefined;
}

export interface IMempoolTransactionObj
    extends Omit<IMempoolTransaction, 'identifier' | 'data' | 'blockHeight'> {
    readonly identifier: bigint;
    readonly data: Buffer | Uint8Array;
    readonly blockHeight: bigint;
}
