export interface Submission {
    readonly mldsaPublicKey: Uint8Array;
    readonly salt: Uint8Array;
    readonly graffiti?: Uint8Array;
}

export interface ExtendedSubmission extends Submission {
    readonly legacyPublicKey: Uint8Array;
}
