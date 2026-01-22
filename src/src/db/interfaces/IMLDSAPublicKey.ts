import { Binary, Long } from 'mongodb';
import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface IMLDSAPublicKey {
    readonly level: MLDSASecurityLevel;
    readonly hashedPublicKey: Buffer;
    readonly legacyPublicKey: Buffer;
    readonly tweakedPublicKey: Buffer;
    // If null, wallet owner did not expose his public key on-chain yet.
    readonly publicKey: Buffer | null;

    // Can be temporally wrong.
    readonly insertedBlockHeight: bigint | null;
    readonly exposedBlockHeight: bigint | null;
}

export interface MLDSAPublicKeyDocument {
    readonly level: MLDSASecurityLevel;
    readonly legacyPublicKey: Binary;
    readonly tweakedPublicKey: Binary;
    readonly publicKey: Binary | null;
    readonly hashedPublicKey: Binary;
    readonly insertedBlockHeight: Long;
    readonly exposedBlockHeight: Long | null;
}

export interface MLDSAUpdateData {
    readonly exposePublicKey: boolean;
    readonly data: IMLDSAPublicKey;
}
