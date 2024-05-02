import { ScriptPubKey } from '@btc-vision/bsi-bitcoin-rpc';

export interface UXTOSOutputTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: bigint;
    readonly scriptPubKey: ScriptPubKey;
}

export type UTXOsOutputTransactions = UXTOSOutputTransaction[];
