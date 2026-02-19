/**
 * Enum of all API packet type names.
 * These correspond to the message names in OPNetAPIProtocol.proto
 */
export enum APIPacketType {
    // Handshake
    HandshakeRequest = 'HandshakeRequest',
    HandshakeResponse = 'HandshakeResponse',

    // Error
    ErrorResponse = 'ErrorResponse',

    // Ping/Pong
    PingRequest = 'PingRequest',
    PongResponse = 'PongResponse',

    // Blocks
    GetBlockNumberRequest = 'GetBlockNumberRequest',
    GetBlockNumberResponse = 'GetBlockNumberResponse',
    GetBlockByNumberRequest = 'GetBlockByNumberRequest',
    BlockResponse = 'BlockResponse',
    GetBlockWitnessRequest = 'GetBlockWitnessRequest',
    BlockWitnessResponse = 'BlockWitnessResponse',
    GetGasRequest = 'GetGasRequest',
    GasResponse = 'GasResponse',

    // Transactions
    GetTransactionByHashRequest = 'GetTransactionByHashRequest',
    TransactionResponse = 'TransactionResponse',
    GetTransactionReceiptRequest = 'GetTransactionReceiptRequest',
    TransactionReceiptResponse = 'TransactionReceiptResponse',
    BroadcastTransactionRequest = 'BroadcastTransactionRequest',
    BroadcastTransactionResponse = 'BroadcastTransactionResponse',
    GetPreimageRequest = 'GetPreimageRequest',
    PreimageResponse = 'PreimageResponse',

    // Addresses
    GetBalanceRequest = 'GetBalanceRequest',
    GetBalanceResponse = 'GetBalanceResponse',
    GetUTXOsRequest = 'GetUTXOsRequest',
    GetUTXOsResponse = 'GetUTXOsResponse',
    GetPublicKeyInfoRequest = 'GetPublicKeyInfoRequest',
    GetPublicKeyInfoResponse = 'GetPublicKeyInfoResponse',

    // Chain
    GetChainIdRequest = 'GetChainIdRequest',
    GetChainIdResponse = 'GetChainIdResponse',
    GetReorgRequest = 'GetReorgRequest',
    GetReorgResponse = 'GetReorgResponse',

    // States
    GetCodeRequest = 'GetCodeRequest',
    GetCodeResponse = 'GetCodeResponse',
    GetStorageAtRequest = 'GetStorageAtRequest',
    GetStorageAtResponse = 'GetStorageAtResponse',
    CallRequest = 'CallRequest',
    CallResponse = 'CallResponse',

    // Epochs
    GetLatestEpochRequest = 'GetLatestEpochRequest',
    EpochResponse = 'EpochResponse',
    GetEpochByNumberRequest = 'GetEpochByNumberRequest',
    GetEpochByHashRequest = 'GetEpochByHashRequest',
    GetEpochTemplateRequest = 'GetEpochTemplateRequest',
    EpochTemplateResponse = 'EpochTemplateResponse',
    SubmitEpochRequest = 'SubmitEpochRequest',
    SubmitEpochResponse = 'SubmitEpochResponse',

    // Mempool
    /** Request: aggregate mempool statistics. */
    GetMempoolInfoRequest = 'GetMempoolInfoRequest',
    /** Response: aggregate mempool statistics. */
    GetMempoolInfoResponse = 'GetMempoolInfoResponse',
    /** Request: single pending transaction by hash. */
    GetPendingTransactionRequest = 'GetPendingTransactionRequest',
    /** Response: single pending mempool transaction. */
    PendingTransactionResponse = 'PendingTransactionResponse',
    /** Request: latest pending transactions with optional address filter. */
    GetLatestPendingTransactionsRequest = 'GetLatestPendingTransactionsRequest',
    /** Response: list of latest pending mempool transactions. */
    LatestPendingTransactionsResponse = 'LatestPendingTransactionsResponse',

    // Subscriptions
    SubscribeBlocksRequest = 'SubscribeBlocksRequest',
    SubscribeBlocksResponse = 'SubscribeBlocksResponse',
    SubscribeEpochsRequest = 'SubscribeEpochsRequest',
    SubscribeEpochsResponse = 'SubscribeEpochsResponse',
    /** Request: subscribe to new mempool transaction notifications. */
    SubscribeMempoolRequest = 'SubscribeMempoolRequest',
    /** Response: mempool subscription confirmation. */
    SubscribeMempoolResponse = 'SubscribeMempoolResponse',
    UnsubscribeRequest = 'UnsubscribeRequest',
    UnsubscribeResponse = 'UnsubscribeResponse',

    // Notifications
    NewBlockNotification = 'NewBlockNotification',
    NewEpochNotification = 'NewEpochNotification',
    /** Server push notification: a new transaction entered the mempool. */
    NewMempoolTransactionNotification = 'NewMempoolTransactionNotification',

    // Common types (for internal use)
    BlockIdentifier = 'BlockIdentifier',
}
