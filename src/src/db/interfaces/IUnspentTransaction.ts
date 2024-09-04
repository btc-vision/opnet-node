import { Binary, Long } from 'mongodb';
import { Address } from '@btc-vision/bsi-binary';

export interface ShortScriptPubKey {
    readonly hex: Binary;
    readonly address: Address | null;
}

export interface IUnspentTransaction {
    readonly blockHeight: Long;

    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: Long;

    readonly scriptPubKey: ShortScriptPubKey;

    readonly deletedAtBlock?: Long;
}

export interface ISpentTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly deletedAtBlock?: Long;
}
