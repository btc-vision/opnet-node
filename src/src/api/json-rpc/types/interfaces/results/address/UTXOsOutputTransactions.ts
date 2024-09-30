import { ScriptPubKey } from '@btc-vision/bsi-bitcoin-rpc';

export interface UTXOSOutputTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: bigint;
    readonly scriptPubKey: ScriptPubKey;
}

export type UTXOsOutputTransactions = {
    confirmed: UTXOSOutputTransaction[];
    spentTransactions: UTXOSOutputTransaction[];
    pending: UTXOSOutputTransaction[];
};
