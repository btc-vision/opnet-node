export interface Submission {
    readonly publicKey: Buffer;
    readonly salt: Buffer;
    readonly graffiti?: Buffer;
}
