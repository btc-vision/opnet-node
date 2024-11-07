import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface PublicKeyInfoAsObject extends JSONRpcParams<JSONRpcMethods.PUBLIC_KEY_INFO> {
    readonly address: string;
}

export type PublicKeyInfoAsArray = [string[]];

export type PublicKeyInfoParams = PublicKeyInfoAsObject | PublicKeyInfoAsArray;
