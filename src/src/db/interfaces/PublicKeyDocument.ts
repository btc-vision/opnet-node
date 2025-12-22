import { Binary } from 'mongodb';
import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface PublicKeyDocument {
    readonly tweakedPublicKey: Binary;
    readonly publicKey?: Binary;

    readonly lowByte?: number;

    readonly p2tr: string;
    readonly p2op?: string;

    readonly p2pkh?: string;
    readonly p2pkhUncompressed?: string;
    readonly p2pkhHybrid?: string;
    readonly p2shp2wpkh?: string;
    readonly p2wpkh?: string;

    readonly mldsaHashedPublicKey?: Binary;
    readonly mldsaLevel?: MLDSASecurityLevel;
    readonly mldsaPublicKey?: Binary;
}
