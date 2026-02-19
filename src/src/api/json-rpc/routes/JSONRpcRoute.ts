import { Routes } from '../../enums/Routes.js';
import { JSONRpcMethods } from '../types/enums/JSONRpcMethods.js';

type JSONRpcRoute = { [key in JSONRpcMethods]: Routes };

export const JSONRpcRouteMethods: JSONRpcRoute = {
    /** Get Block Current Height */
    [JSONRpcMethods.BLOCK_BY_NUMBER]: Routes.LATEST_BLOCK,

    /** Blocks */
    [JSONRpcMethods.GET_BLOCK_BY_HASH]: Routes.BLOCK_BY_HASH,
    [JSONRpcMethods.GET_BLOCK_BY_CHECKSUM]: Routes.BLOCK_BY_CHECKSUM,
    [JSONRpcMethods.GET_BLOCK_BY_NUMBER]: Routes.BLOCK_BY_ID,
    [JSONRpcMethods.BLOCK_WITNESS]: Routes.BLOCK_WITNESS,
    [JSONRpcMethods.GAS]: Routes.GAS,

    /** Addresses */
    [JSONRpcMethods.PUBLIC_KEY_INFO]: Routes.PUBLIC_KEY_INFO,
    [JSONRpcMethods.GET_BALANCE]: Routes.GET_BALANCE,
    [JSONRpcMethods.GET_UTXOS]: Routes.UTXOS,

    /** Chain */
    [JSONRpcMethods.CHAIN_ID]: Routes.CHAIN_ID,
    [JSONRpcMethods.REORG]: Routes.REORG,

    /** Transactions */
    [JSONRpcMethods.GET_TRANSACTION_BY_HASH]: Routes.TRANSACTION_BY_HASH,
    [JSONRpcMethods.BROADCAST_TRANSACTION]: Routes.BROADCAST_TRANSACTION,
    [JSONRpcMethods.TRANSACTION_PREIMAGE]: Routes.TRANSACTION_PREIMAGE,

    /** State Methods */
    [JSONRpcMethods.GET_TRANSACTION_RECEIPT]: Routes.TRANSACTION_RECEIPT,
    [JSONRpcMethods.GET_CODE]: Routes.GET_CODE,
    [JSONRpcMethods.GET_STORAGE_AT]: Routes.GET_STORAGE_AT,
    [JSONRpcMethods.CALL]: Routes.CALL,

    /** Epochs */
    [JSONRpcMethods.LATEST_EPOCH]: Routes.LATEST_EPOCH,
    [JSONRpcMethods.GET_EPOCH_BY_NUMBER]: Routes.EPOCH_BY_NUMBER,
    [JSONRpcMethods.GET_EPOCH_BY_HASH]: Routes.EPOCH_BY_HASH,
    [JSONRpcMethods.GET_EPOCH_TEMPLATE]: Routes.EPOCH_TEMPLATE,
    [JSONRpcMethods.SUBMIT_EPOCH]: Routes.SUBMIT_EPOCH,

    /** Mempool */
    [JSONRpcMethods.GET_MEMPOOL_INFO]: Routes.MEMPOOL_INFO,
    [JSONRpcMethods.GET_PENDING_TRANSACTION]: Routes.MEMPOOL_TRANSACTION,
    [JSONRpcMethods.GET_LATEST_PENDING_TRANSACTIONS]: Routes.MEMPOOL_TRANSACTIONS,
};
