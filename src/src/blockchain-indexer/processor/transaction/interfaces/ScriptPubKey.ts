export interface ScriptPubKey {
    readonly asm: string;
    readonly hex: string;
    readonly reqSigs: number;
    readonly type: string;
    readonly addresses: string[];
}
