import { ScriptPubKey } from '@btc-vision/bitcoin-rpc';

export interface UTXOSOutputTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: bigint;
    readonly scriptPubKey: ScriptPubKey;
    readonly raw?: string;
}

export type UTXOsOutputTransactions = {
    confirmed: UTXOSOutputTransaction[];
    spentTransactions: UTXOSOutputTransaction[];
    pending: UTXOSOutputTransaction[];
};
