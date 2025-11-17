import { ScriptPubKey } from '@btc-vision/bitcoin-rpc';

export interface UTXOSOutputTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: bigint;
    readonly scriptPubKey: ScriptPubKey;
    readonly raw?: number;
}

export interface SpentUTXOSOutputTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
}

export interface RawUTXOsAggregationResultV3 {
    readonly utxos: UTXOSOutputTransaction[];
    readonly raw: string[];
}

export type UTXOsOutputTransactions = {
    confirmed: UTXOSOutputTransaction[];
    spentTransactions: SpentUTXOSOutputTransaction[];
    pending: UTXOSOutputTransaction[];
    raw: string[];
};
