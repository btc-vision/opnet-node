import { EventReceiptDataForAPI } from '../../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface TransactionReceiptResultAPI {
    readonly receipt: string | null;
    readonly receiptProofs: string[];
    readonly events: EventReceiptDataForAPI[];

    readonly revert?: string;
    readonly gasUsed: string;
}

export type TransactionReceiptResult = JSONRpc2ResultData<JSONRpcMethods.GET_TRANSACTION_RECEIPT> &
    TransactionReceiptResultAPI;
