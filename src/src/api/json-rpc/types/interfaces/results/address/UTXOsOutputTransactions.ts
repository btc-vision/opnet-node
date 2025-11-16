import { ScriptPubKey } from '@btc-vision/bitcoin-rpc';

export interface UTXOSOutputTransaction {
    readonly transactionId: string;
    readonly outputIndex: number;
    readonly value: bigint;
    readonly scriptPubKey: ScriptPubKey;
    readonly raw?: string;
}

export interface RawUTXOSOutputTransaction extends Omit<UTXOSOutputTransaction, 'raw'> {
    readonly raw?: number;
}

export type UTXOsOutputTransactions = {
    confirmed: UTXOSOutputTransaction[];
    spentTransactions: UTXOSOutputTransaction[];
    pending: UTXOSOutputTransaction[];
};

export interface RawUTXOsOutputTransactions {
    confirmed: RawUTXOSOutputTransaction[];
    spentTransactions: RawUTXOSOutputTransaction[];
    pending: RawUTXOSOutputTransaction[];
    raw: string[];
}
