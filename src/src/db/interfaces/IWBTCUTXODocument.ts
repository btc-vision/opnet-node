import { Binary, Decimal128 } from 'mongodb';
import { Address } from '@btc-vision/bsi-binary';

export interface IWBTCUTXODocument {
    readonly vault: Address;
    readonly blockId: Decimal128;

    readonly hash: string;
    readonly value: Decimal128;
    readonly outputIndex: number;

    readonly output: Binary;
}

export interface IUsedWBTCUTXODocument {
    readonly vault: Address;
    readonly hash: string;
    readonly outputIndex: number;
}
