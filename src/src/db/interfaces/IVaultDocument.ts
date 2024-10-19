import { Address } from '@btc-vision/transaction';
import { Binary, Decimal128 } from 'mongodb';

export interface IVaultDocument {
    readonly vault: Address;
    readonly firstSeen: Decimal128;
    readonly minimum: number;

    readonly publicKeys: Binary[];
}
