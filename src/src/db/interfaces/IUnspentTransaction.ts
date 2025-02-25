import { Binary, Long } from 'mongodb';

export interface ShortScriptPubKey {
    readonly hex: Binary;
    readonly address: string | null;
    readonly addresses: string[] | null;
}

export interface IUnspentTransaction {
    blockHeight: Long;

    readonly transactionId: Binary | Buffer;
    readonly outputIndex: number;
    value: Long;

    scriptPubKey: ShortScriptPubKey;

    readonly deletedAtBlock?: Long;
}

export interface ISpentTransaction {
    readonly transactionId: Buffer;
    readonly outputIndex: number;
    readonly deletedAtBlock?: Long;
}
