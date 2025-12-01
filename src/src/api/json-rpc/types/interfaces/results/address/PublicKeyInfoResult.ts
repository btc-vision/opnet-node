import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { MLDSASecurityLevel } from '../../../../../../../../../transaction/src/index.js';

export interface PublicKeyInfo {
    readonly originalPubKey?: string;
    readonly tweakedPubkey: string;

    readonly p2tr: string;
    readonly p2op?: string;

    readonly lowByte?: number;

    readonly p2pkh?: string;
    readonly p2pkhUncompressed?: string;
    readonly p2pkhHybrid?: string;

    readonly p2shp2wpkh?: string;
    readonly p2wpkh?: string;

    mldsaHashedPublicKey?: string;
    mldsaLevel?: MLDSASecurityLevel;
    mldsaPublicKey?: string | null;
}

export interface IPubKeyNotFoundError {
    readonly error: string;
}

export interface IPublicKeyInfoResult {
    [key: string]: PublicKeyInfo | IPubKeyNotFoundError;
}

export type PublicKeyInfoResult = JSONRpc2ResultData<JSONRpcMethods.PUBLIC_KEY_INFO> &
    IPublicKeyInfoResult;
