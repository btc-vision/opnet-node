import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface PublicKeyInfo {
    readonly originalPubKey?: string;
    readonly tweakedPubkey: string;

    readonly p2tr: string;

    readonly lowByte?: number;

    readonly p2pkh?: string;
    readonly p2shp2wpkh?: string;
    readonly p2wpkh?: string;
}

export interface IPubKeyNotFoundError {
    readonly error: string;
}

export interface IPublicKeyInfoResult {
    [key: string]: (PublicKeyInfo | IPubKeyNotFoundError)[];
}

export type PublicKeyInfoResult = JSONRpc2ResultData<JSONRpcMethods.PUBLIC_KEY_INFO> &
    IPublicKeyInfoResult;
