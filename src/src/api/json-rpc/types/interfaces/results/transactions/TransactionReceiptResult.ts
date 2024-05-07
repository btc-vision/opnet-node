import { NetEvent } from '@btc-vision/bsi-binary';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface TransactionReceiptResultAPI {
    readonly receipt: string | null;
    readonly receiptProofs: string[];
    readonly events: NetEvent[];

    readonly revert?: string;
}

export type TransactionReceiptResult = JSONRpc2ResultData<JSONRpcMethods.GET_TRANSACTION_RECEIPT> &
    TransactionReceiptResultAPI;
