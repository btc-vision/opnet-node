import { IBaseDocument } from '@btc-vision/bsi-common';
import {Binary, Decimal128, Long} from 'mongodb';

export interface IContractPointerValueDocument extends IBaseDocument {
    readonly contractAddress: Uint8Array;
    readonly pointer: Binary;
    readonly value: Binary;

    readonly proofs: string[];
    lastSeenAt: bigint | Long;
}
