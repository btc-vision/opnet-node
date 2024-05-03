import { Routes } from '../../enums/Routes.js';
import { JSONRpcMethods } from '../types/enums/JSONRpcMethods.js';

type JSONRpcRoute = { [key in JSONRpcMethods]: Routes };

export const JSONRpcRouteMethods: JSONRpcRoute = {
    /** Get Block Current Height */
    [JSONRpcMethods.BLOCK_BY_NUMBER]: Routes.LATEST_BLOCK,

    /** Blocks */
    [JSONRpcMethods.GET_BLOCK_BY_HASH]: Routes.BLOCK_BY_HASH,
    [JSONRpcMethods.GET_BLOCK_BY_NUMBER]: Routes.BLOCK_BY_ID,

    /** Chain */
    [JSONRpcMethods.CHAIN_ID]: Routes.CHAIN_ID,

    /** Transactions */
    [JSONRpcMethods.GET_TRANSACTION_BY_HASH]: Routes.TRANSACTION_BY_HASH,
    [JSONRpcMethods.SEND_RAW_TRANSACTION]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.SIMULATE_TRANSACTION]: Routes.NOT_IMPLEMENTED,

    /** Historical */
    [JSONRpcMethods.GET_UTXOS]: Routes.UTXOS,

    /** State Methods */
    [JSONRpcMethods.GET_TRANSACTION_RECEIPT]: Routes.TRANSACTION_RECEIPT,
    [JSONRpcMethods.GET_CODE]: Routes.GET_CODE,
    [JSONRpcMethods.GET_STORAGE_AT]: Routes.GET_STORAGE_AT,
    [JSONRpcMethods.GET_BALANCE]: Routes.GET_BALANCE,
    [JSONRpcMethods.CALL]: Routes.CALL,

    /** Vaults */
    [JSONRpcMethods.GET_VAULT_BY_ID]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_TRUSTED_VALIDATORS]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_VALIDATOR_BY_ID]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.BUILD_WITHDRAWAL]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.ESTIMATE_WITHDRAWAL_GAS]: Routes.NOT_IMPLEMENTED,
};
