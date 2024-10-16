import { Binary } from 'mongodb';

export interface PublicKeyDocument {
    readonly p2tr: string;

    tweakedPublicKey: Binary;
    publicKey?: Binary;

    readonly p2pkh?: string;
    readonly p2shp2wpkh?: string;
    readonly p2wpkh?: string;
}
