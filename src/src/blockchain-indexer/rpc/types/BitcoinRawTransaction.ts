import { BitcoinVerbosity } from './BitcoinVerbosity.js';

export interface BitcoinRawTransactionParams {
    txId: string;
    blockHash?: string;
    verbose?: BitcoinVerbosity;
}

export interface ScriptSig {
    asm: string;
    hex: string;
}

export interface Vin {
    txid: string;
    vout: number;
    scriptSig: ScriptSig;
    sequence: number;
    txinwitness?: string[]; // Optional since not all transactions have witness data
}

export interface ScriptPubKey {
    asm: string;
    hex: string;
    reqSigs: number;
    type: string; // Consider enum if there are known, limited values for type
    addresses: string[];
}

export interface Vout {
    value: number;
    n: number;
    scriptPubKey: ScriptPubKey;
}

export interface TransactionDetail {
    in_active_chain?: boolean; // Optional as it only appears with "blockhash" argument
    hex: string;
    txid: string;
    hash: string;
    size: number;
    vsize: number;
    weight: number;
    version: number;
    locktime: number;
    vin: Vin[];
    vout: Vout[];
    blockhash?: string; // Optional as it might not be present for unconfirmed transactions
    confirmations?: number; // Optional for similar reason as blockhash
    blocktime?: number; // Optional for similar reason as blockhash
    time?: number; // Optional for similar reason as blockhash
}

export type RawTransaction<V extends BitcoinVerbosity> = V extends BitcoinVerbosity.RAW
    ? string
    : TransactionDetail;
