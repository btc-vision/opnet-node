import { BlockHeaderAPIDocumentWithTransactions } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { JSONRpcMethods } from '../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../JSONRpc2ResultData.js';

export type BlockByIdResult = JSONRpc2ResultData<
    JSONRpcMethods.GET_BLOCK_BY_NUMBER | JSONRpcMethods.GET_BLOCK_BY_HASH
> &
    BlockHeaderAPIDocumentWithTransactions;
