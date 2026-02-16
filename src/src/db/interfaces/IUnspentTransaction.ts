import { Binary, Long } from 'mongodb';

export interface ShortScriptPubKey {
    readonly hex: Binary;
    readonly address: string | null;
    readonly addresses: string[] | null;
}

export interface IUnspentTransaction {
    blockHeight: Long;

    readonly transactionId: Binary | Uint8Array;
    readonly outputIndex: number;
    value: Long;

    scriptPubKey: ShortScriptPubKey;

    readonly deletedAtBlock?: Long;
}

export interface ISpentTransaction {
    readonly transactionId: Uint8Array;
    readonly outputIndex: number;
    readonly deletedAtBlock?: Long;
}
