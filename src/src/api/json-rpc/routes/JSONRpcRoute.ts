import { Routes } from '../../enums/Routes.js';
import { JSONRpcMethods } from '../types/enums/JSONRpcMethods.js';

type JSONRpcRoute = { [key in JSONRpcMethods]: Routes };

export const JSONRpcRouteMethods: JSONRpcRoute = {
    /** Get Block Current Height */
    [JSONRpcMethods.BLOCK_BY_NUMBER]: Routes.LATEST_BLOCK,

    /** Block Headers */
    [JSONRpcMethods.GET_BLOCK_HEADER_BY_HASH]: Routes.BLOCK_BY_HASH,
    [JSONRpcMethods.GET_BLOCK_HEADER_BY_NUMBER]: Routes.BLOCK_BY_ID,

    /** Blocks */
    [JSONRpcMethods.GET_BLOCK_BY_HASH]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_BLOCK_BY_NUMBER]: Routes.NOT_IMPLEMENTED,

    /** Transactions */
    [JSONRpcMethods.GET_TRANSACTION_BY_HASH]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.SEND_RAW_TRANSACTION]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.SIMULATE_TRANSACTION]: Routes.NOT_IMPLEMENTED,

    /** Historical */
    [JSONRpcMethods.GET_UXTOS]: Routes.NOT_IMPLEMENTED,

    /** State Methods */
    [JSONRpcMethods.GET_TRANSACTION_RECEIPT]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_CODE]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_STORAGE_AT]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_BALANCE]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.CALL]: Routes.NOT_IMPLEMENTED,

    /** Vaults */
    [JSONRpcMethods.GET_VAULT_BY_ID]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_TRUSTED_VALIDATORS]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_VALIDATOR_BY_ID]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.BUILD_WITHDRAWAL]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.ESTIMATE_WITHDRAWAL_GAS]: Routes.NOT_IMPLEMENTED,
};
