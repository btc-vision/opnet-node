import { Binary } from 'mongodb';

export interface PublicKeyDocument {
    readonly tweakedPublicKey: Binary;
    readonly publicKey?: Binary;

    readonly lowByte?: number;

    readonly p2tr: string;

    readonly p2pkh?: string;
    readonly p2pkhUncompressed?: string;
    readonly p2pkhHybrid?: string;
    readonly p2shp2wpkh?: string;
    readonly p2wpkh?: string;
}
