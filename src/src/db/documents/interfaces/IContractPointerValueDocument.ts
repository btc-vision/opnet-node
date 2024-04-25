import { IBaseDocument } from '@btc-vision/bsi-common';
import { Binary, Decimal128 } from 'mongodb';

export interface IContractPointerValueDocument extends IBaseDocument {
    readonly contractAddress: string;
    readonly pointer: Binary;
    readonly value: Binary;

    readonly proofs: string[];
    lastSeenAt: Decimal128;
}
