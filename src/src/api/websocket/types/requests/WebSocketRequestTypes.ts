/**
 * WebSocket API Request Types
 * These interfaces define the shape of incoming WebSocket requests after protobuf deserialization.
 */

// ============================================================================
// Base Types
// ============================================================================

export interface BaseRequest {
    readonly requestId: number;
}

export interface BlockIdentifier {
    readonly height?: number | bigint;
    readonly hash?: string;
    readonly checksum?: string;
}

// ============================================================================
// Block Requests
// ============================================================================

export interface GetBlockNumberRequest extends BaseRequest {}

export interface GetBlockByNumberRequest extends BaseRequest {
    readonly identifier?: BlockIdentifier;
    readonly includeTransactions?: boolean;
}

export interface GetBlockByHashRequest extends BaseRequest {
    readonly identifier?: BlockIdentifier;
    readonly includeTransactions?: boolean;
}

export interface GetBlockByChecksumRequest extends BaseRequest {
    readonly identifier?: BlockIdentifier;
    readonly includeTransactions?: boolean;
}

export interface GetBlockWitnessRequest extends BaseRequest {
    readonly height: number | bigint;
    readonly trusted?: boolean;
    readonly limit?: number;
    readonly page?: number;
}

export interface GetGasRequest extends BaseRequest {}

// ============================================================================
// Transaction Requests
// ============================================================================

export interface GetTransactionByHashRequest extends BaseRequest {
    readonly txHash: string;
}

export interface GetTransactionReceiptRequest extends BaseRequest {
    readonly txHash: string;
}

export interface BroadcastTransactionRequest extends BaseRequest {
    readonly transaction: Uint8Array;
    readonly psbt: boolean;
}

export interface GetPreimageRequest extends BaseRequest {}

// ============================================================================
// Address Requests
// ============================================================================

export interface GetBalanceRequest extends BaseRequest {
    readonly address: string;
    readonly filterOrdinals?: boolean;
}

export interface GetUTXOsRequest extends BaseRequest {
    readonly address: string;
    readonly optimize?: boolean;
}

export interface GetPublicKeyInfoRequest extends BaseRequest {
    readonly addresses: string[];
}

// ============================================================================
// Chain Requests
// ============================================================================

export interface GetChainIdRequest extends BaseRequest {}

export interface GetReorgRequest extends BaseRequest {
    readonly fromBlock?: string;
    readonly toBlock?: string;
}

// ============================================================================
// State Requests
// ============================================================================

export interface GetCodeRequest extends BaseRequest {
    readonly contractAddress: string;
    readonly full?: boolean;
}

export interface GetStorageAtRequest extends BaseRequest {
    readonly contractAddress: string;
    readonly pointer: string;
    readonly proofs?: boolean;
}

export interface CallRequest extends BaseRequest {
    readonly to: string;
    readonly calldata: string;
    readonly from?: string;
    readonly fromLegacy?: string;
}

// ============================================================================
// Epoch Requests
// ============================================================================

export interface GetLatestEpochRequest extends BaseRequest {}

export interface GetEpochByNumberRequest extends BaseRequest {
    readonly epochNumber: number | bigint;
}

export interface GetEpochByHashRequest extends BaseRequest {
    readonly epochHash: string;
}

export interface GetEpochTemplateRequest extends BaseRequest {}

export interface SubmitEpochRequest extends BaseRequest {
    readonly epochNumber: string;
    readonly checksumRoot: string;
    readonly salt: string;
    readonly mldsaPublicKey: string;
    readonly graffiti?: string;
    readonly signature: string;
}

// ============================================================================
// Mempool Requests
// ============================================================================

/** WebSocket request for mempool statistics (no additional fields). */
export interface GetMempoolInfoWsRequest extends BaseRequest {}

/** WebSocket request to fetch a single pending transaction by hash. */
export interface GetPendingTransactionWsRequest extends BaseRequest {
    /** The 64-character hex transaction hash. */
    readonly hash: string;
}

/** WebSocket request to fetch the latest pending transactions. */
export interface GetLatestPendingTransactionsWsRequest extends BaseRequest {
    /** A single address to auto-resolve into all derived wallet address types. */
    readonly address?: string;
    /** Explicit list of addresses to filter by. */
    readonly addresses?: string[];
    /** Maximum number of transactions to return. */
    readonly limit?: number;
}

// ============================================================================
// Subscription Requests
// ============================================================================

export interface SubscribeBlocksRequest extends BaseRequest {}

export interface SubscribeEpochsRequest extends BaseRequest {}

/** WebSocket request to subscribe to new mempool transaction notifications. */
export interface SubscribeMempoolWsRequest extends BaseRequest {}

export interface UnsubscribeRequest extends BaseRequest {
    readonly subscriptionId: number;
}
