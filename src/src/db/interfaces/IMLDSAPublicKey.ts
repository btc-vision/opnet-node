import { Binary, Long } from 'mongodb';
import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface IMLDSAPublicKey {
    readonly level: MLDSASecurityLevel;
    readonly hashedPublicKey: Buffer;
    readonly legacyPublicKey: Buffer;
    // If null, wallet owner did not expose his public key on-chain yet.
    readonly publicKey: Buffer | null;
    readonly insertedBlockHeight: bigint | null;
    readonly exposedBlockHeight: bigint | null;
}

export interface IMLDSAPublicKeyWithExposedKey extends IMLDSAPublicKey {
    readonly publicKey: Buffer;
    readonly exposedBlockHeight: bigint;
}

export interface MLDSAPublicKeyDocument {
    readonly level: MLDSASecurityLevel;
    readonly legacyPublicKey: Binary;
    readonly publicKey: Binary | null;
    readonly hashedPublicKey: Binary;
    readonly insertedBlockHeight: Long;
    readonly exposedBlockHeight: Long | null;
}

export interface MLDSAUpdateData {
    readonly exposePublicKey: boolean;
    readonly data: IMLDSAPublicKey;
}
