import { Binary } from 'mongodb';

export interface IMempoolTransaction {
    readonly identifier: Binary;
    id?: string | null;

    readonly data: Binary;

    readonly psbt: boolean;
    readonly previousPsbtId?: string | null;

    readonly firstSeen: Date | undefined;
}

export interface IMempoolTransactionObj extends Omit<IMempoolTransaction, 'identifier' | 'data'> {
    readonly identifier: bigint;
    readonly data: Buffer | Uint8Array;
}
