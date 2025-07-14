import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface EpochByNumberParamsAsObject
    extends JSONRpcParams<JSONRpcMethods.GET_EPOCH_BY_NUMBER> {
    readonly height: bigint | -1 | string;
}

export type EpochByNumberParamsAsArray = [string | bigint | -1];

export type EpochByNumberParams = EpochByNumberParamsAsObject | EpochByNumberParamsAsArray;
