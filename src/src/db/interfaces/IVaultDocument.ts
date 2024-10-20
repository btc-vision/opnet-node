import { Binary, Decimal128 } from 'mongodb';

export interface IVaultDocument {
    readonly vault: string;
    readonly firstSeen: Decimal128;
    readonly minimum: number;

    readonly publicKeys: Binary[];
}
