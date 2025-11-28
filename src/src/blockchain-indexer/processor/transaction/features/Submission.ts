export interface Submission {
    readonly mldsaPublicKey: Buffer;
    readonly legacyPublicKey: Buffer;
    readonly salt: Buffer;
    readonly graffiti?: Buffer;
}
