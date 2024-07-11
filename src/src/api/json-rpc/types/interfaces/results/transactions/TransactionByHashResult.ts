import { OPNetTransactionTypes } from '../../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionDocumentForAPI } from '../../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export type TransactionByHashResult = JSONRpc2ResultData<JSONRpcMethods.GET_TRANSACTION_BY_HASH> &
    TransactionDocumentForAPI<OPNetTransactionTypes>;
