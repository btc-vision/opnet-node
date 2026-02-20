import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

/** Object-form parameters for {@link JSONRpcMethods.GET_MEMPOOL_INFO} (none required). */
export interface GetMempoolInfoParamsAsObject extends JSONRpcParams<JSONRpcMethods.GET_MEMPOOL_INFO> {}

/** Array-form parameters (empty). */
export type GetMempoolInfoParamsAsArray = [];

/** Accepted parameter shapes for `btc_getMempoolInfo`. */
export type GetMempoolInfoParams = GetMempoolInfoParamsAsObject | GetMempoolInfoParamsAsArray;
