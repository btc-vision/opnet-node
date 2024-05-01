export enum JSONRpcMethods {
    /** Get Block Current Height */
    BLOCK_BY_NUMBER = 'btc_blockNumber',

    /** Block Headers */
    GET_BLOCK_HEADER_BY_HASH = 'btc_getBlockHeaderByHash',
    GET_BLOCK_HEADER_BY_NUMBER = 'btc_getBlockHeaderByNumber',

    /** Blocks */
    GET_BLOCK_BY_HASH = 'btc_getBlockByHash',
    GET_BLOCK_BY_NUMBER = 'btc_getBlockByNumber',

    /** Transactions */
    GET_TRANSACTION_BY_HASH = 'btc_getTransactionByHash',
    SEND_RAW_TRANSACTION = 'btc_sendRawTransaction',
    SIMULATE_TRANSACTION = 'btc_simulateTransaction',

    /** Historical */
    GET_UTXOS = 'btc_getUTXOs',

    /** State Methods */
    GET_TRANSACTION_RECEIPT = 'btc_getTransactionReceipt',
    GET_CODE = 'btc_getCode',
    GET_STORAGE_AT = 'btc_getStorageAt',
    GET_BALANCE = 'btc_getBalance',
    CALL = 'btc_call',

    /** Vaults */
    GET_VAULT_BY_ID = 'btc_getVaultById',
    GET_TRUSTED_VALIDATORS = 'btc_getTrustedValidators',
    GET_VALIDATOR_BY_ID = 'btc_getValidatorById',
    BUILD_WITHDRAWAL = 'btc_buildWithdrawal',
    ESTIMATE_WITHDRAWAL_GAS = 'btc_estimateWithdrawalGas',
}
