import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface PublicKeyInfo {
    originalPubKey?: string;
    tweakedPubkey?: string;

    p2tr?: string;
    p2op?: string;

    lowByte?: number;

    p2pkh?: string;
    readonly p2pkhUncompressed?: string;
    readonly p2pkhHybrid?: string;

    p2shp2wpkh?: string;
    p2wpkh?: string;

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
