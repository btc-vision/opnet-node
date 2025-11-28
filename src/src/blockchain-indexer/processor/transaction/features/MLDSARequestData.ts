import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface MLDSARequestData {
    readonly publicKey: Buffer;
    readonly level: MLDSASecurityLevel;

    readonly mldsaSignature: Buffer;
    readonly legacySignature: Buffer;
}
