import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface UTXOsByAddressParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_UTXOS> {
    readonly address: string;
    readonly optimize?: boolean;
}

export type UTXOsByAddressParamsAsArray = [string, boolean?];

export type UTXOsByAddressParams = UTXOsByAddressParamsAsObject | UTXOsByAddressParamsAsArray;
