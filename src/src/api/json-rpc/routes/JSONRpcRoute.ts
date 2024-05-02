import { Routes } from '../../enums/Routes.js';
import { JSONRpcMethods } from '../types/enums/JSONRpcMethods.js';

type JSONRpcRoute = { [key in JSONRpcMethods]: Routes };

export const JSONRpcRouteMethods: JSONRpcRoute = {
    /** Get Block Current Height */
    [JSONRpcMethods.BLOCK_BY_NUMBER]: Routes.LATEST_BLOCK,

    /** Blocks */
    [JSONRpcMethods.GET_BLOCK_BY_HASH]: Routes.BLOCK_BY_HASH,
    [JSONRpcMethods.GET_BLOCK_BY_NUMBER]: Routes.BLOCK_BY_ID,

    /** Transactions */
    [JSONRpcMethods.GET_TRANSACTION_BY_HASH]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.SEND_RAW_TRANSACTION]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.SIMULATE_TRANSACTION]: Routes.NOT_IMPLEMENTED,

    /** Historical */
    [JSONRpcMethods.GET_UTXOS]: Routes.UTXOS,

    /** State Methods */
    [JSONRpcMethods.GET_TRANSACTION_RECEIPT]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_CODE]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_STORAGE_AT]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_BALANCE]: Routes.GET_BALANCE,
    [JSONRpcMethods.CALL]: Routes.NOT_IMPLEMENTED,

    /** Vaults */
    [JSONRpcMethods.GET_VAULT_BY_ID]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_TRUSTED_VALIDATORS]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.GET_VALIDATOR_BY_ID]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.BUILD_WITHDRAWAL]: Routes.NOT_IMPLEMENTED,
    [JSONRpcMethods.ESTIMATE_WITHDRAWAL_GAS]: Routes.NOT_IMPLEMENTED,
};
