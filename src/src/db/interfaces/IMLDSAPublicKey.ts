import { Binary, Long } from 'mongodb';

export interface IMLDSAPublicKey {
    readonly hashedPublicKey: Buffer;
    readonly legacyPublicKey: Buffer;
    readonly publicKey: Buffer;
    readonly blockHeight: bigint;
}

export interface MLDSAPublicKeyDocument {
    readonly legacyPublicKey: Binary;
    readonly publicKey: Binary;
    readonly hashedPublicKey: Binary;
    readonly blockHeight: Long;
}
