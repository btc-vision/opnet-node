export interface ScriptPubKey {
    asm: string;
    hex: string;
    reqSigs: number;
    type: string;
    addresses: string[];
}

export interface TransactionOutputInfo {
    bestblock: string;
    confirmations: number;
    value: number;
    scriptPubKey: ScriptPubKey;
    coinbase: boolean;
}
