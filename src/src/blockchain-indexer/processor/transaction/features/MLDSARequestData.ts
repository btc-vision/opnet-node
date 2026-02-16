import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface MLDSARequestData {
    readonly verifyRequest: boolean;
    readonly publicKey: Uint8Array | null;
    readonly hashedPublicKey: Uint8Array;
    readonly level: MLDSASecurityLevel;

    readonly mldsaSignature: Uint8Array | null;
    readonly legacySignature: Uint8Array;
}
