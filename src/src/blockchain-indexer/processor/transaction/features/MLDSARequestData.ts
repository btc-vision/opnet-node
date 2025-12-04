import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface MLDSARequestData {
    readonly verifyRequest: boolean;
    readonly publicKey: Buffer | null;
    readonly hashedPublicKey: Buffer;
    readonly level: MLDSASecurityLevel;

    readonly mldsaSignature: Buffer | null;
    readonly legacySignature: Buffer;
}
