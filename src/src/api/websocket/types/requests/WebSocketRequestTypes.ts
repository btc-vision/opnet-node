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
    readonly transaction: Buffer | Uint8Array;
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
    readonly targetHash: string;
    readonly salt: string;
    readonly mldsaPublicKey: string;
    readonly graffiti?: string;
    readonly signature: string;
}

// ============================================================================
// Subscription Requests
// ============================================================================

export interface SubscribeBlocksRequest extends BaseRequest {}

export interface SubscribeEpochsRequest extends BaseRequest {}

export interface UnsubscribeRequest extends BaseRequest {
    readonly subscriptionId: number;
}
