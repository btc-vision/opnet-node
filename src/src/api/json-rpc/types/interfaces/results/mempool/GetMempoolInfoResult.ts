import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

/** Core mempool statistics returned by `btc_getMempoolInfo`. */
export interface MempoolInfoData {
    /** Total number of pending transactions in the mempool. */
    readonly count: number;
    /** Number of pending OPNet-specific transactions in the mempool. */
    readonly opnetCount: number;
    /** Total byte size of the mempool. */
    readonly size: number;
}

/** Result type for the `btc_getMempoolInfo` JSON-RPC method. */
export type GetMempoolInfoResult = JSONRpc2ResultData<JSONRpcMethods.GET_MEMPOOL_INFO> &
    MempoolInfoData;
