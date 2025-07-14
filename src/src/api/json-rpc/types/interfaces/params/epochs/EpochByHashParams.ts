import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface EpochByHashParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_EPOCH_BY_HASH> {
    readonly hash: string;
}

export type EpochByHashParamsAsArray = [string];

export type EpochByHashParams = EpochByHashParamsAsObject | EpochByHashParamsAsArray;
