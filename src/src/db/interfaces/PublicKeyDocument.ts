import { Binary } from 'mongodb';

export interface PublicKeyDocument {
    readonly tweakedPublicKey: Binary;
    readonly publicKey?: Binary;

    readonly lowByte?: number;

    readonly p2tr: string;

    readonly p2pkh?: string;
    readonly p2shp2wpkh?: string;
    readonly p2wpkh?: string;
}

export interface PublicKeyDocumentNotReadonly {
    tweakedPublicKey: Binary;
    publicKey?: Binary;

    lowByte?: number;

    p2tr: string;

    p2pkh?: string;
    p2shp2wpkh?: string;
    p2wpkh?: string;
}
