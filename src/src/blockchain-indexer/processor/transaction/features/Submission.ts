export interface Submission {
    readonly mldsaPublicKey: Buffer;
    readonly salt: Buffer;
    readonly graffiti?: Buffer;
}

export interface ExtendedSubmission extends Submission {
    readonly legacyPublicKey: Buffer;
}
