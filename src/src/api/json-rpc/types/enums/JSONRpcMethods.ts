export enum JSONRpcMethods {
    /** Get Block Current Height */
    BLOCK_BY_NUMBER = 'btc_blockNumber',

    /** Chain */
    CHAIN_ID = 'btc_chainId',
    REORG = 'btc_reorg',

    /** Blocks */
    GET_BLOCK_BY_HASH = 'btc_getBlockByHash',
    GET_BLOCK_BY_NUMBER = 'btc_getBlockByNumber',

    /** Transactions */
    GET_TRANSACTION_BY_HASH = 'btc_getTransactionByHash',
    SEND_RAW_TRANSACTION = 'btc_sendRawTransaction', // TODO: Implement
    SIMULATE_TRANSACTION = 'btc_simulateTransaction', // TODO: Implement

    /** Historical */
    GET_UTXOS = 'btc_getUTXOs',

    /** State Methods */
    GET_TRANSACTION_RECEIPT = 'btc_getTransactionReceipt',
    GET_CODE = 'btc_getCode',
    GET_STORAGE_AT = 'btc_getStorageAt',
    GET_BALANCE = 'btc_getBalance',
    CALL = 'btc_call', // TODO: Implement

    /** Vaults */
    GET_VAULT_BY_ID = 'btc_getVaultById', // TODO: Implement
    GET_TRUSTED_VALIDATORS = 'btc_getTrustedValidators', // TODO: Implement
    GET_VALIDATOR_BY_ID = 'btc_getValidatorById', // TODO: Implement
    BUILD_WITHDRAWAL = 'btc_buildWithdrawal', // TODO: Implement
    ESTIMATE_WITHDRAWAL_GAS = 'btc_estimateWithdrawalGas', // TODO: Implement
}
