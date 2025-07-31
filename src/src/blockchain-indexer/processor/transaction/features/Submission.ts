export interface Submission {
    readonly publicKey: Uint8Array;
    readonly salt: Uint8Array;
    readonly graffiti?: Uint8Array;
}
