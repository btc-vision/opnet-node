import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface EpochByHashParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_EPOCH_BY_HASH> {
    readonly hash: string;
    readonly includeSubmissions?: boolean;
}

export type EpochByHashParamsAsArray = [string, boolean?];

export type EpochByHashParams = EpochByHashParamsAsObject | EpochByHashParamsAsArray;
