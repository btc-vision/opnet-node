import { Binary, Long } from 'mongodb';

export interface ShortScriptPubKey {
    readonly hex: Binary;
    readonly address: string | null;
}

export interface IUnspentTransaction {
    blockHeight: Long;

    readonly transactionId: string;
    readonly outputIndex: number;
    value: Long;

    scriptPubKey: ShortScriptPubKey;

    readonly deletedAtBlock?: Long;
}

export interface ISpentTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly deletedAtBlock?: Long;
}
