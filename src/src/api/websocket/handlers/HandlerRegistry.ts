import { Logger } from '@btc-vision/bsi-common';
import { APIRegistry } from '../OpcodeRegistry.js';
import { WebSocketRequestOpcode } from '../types/opcodes/WebSocketOpcodes.js';
import { WSManager } from '../WebSocketManager.js';
import { SubscriptionType } from '../types/enums/SubscriptionType.js';
import { InternalError, ResourceError } from '../types/errors/WebSocketErrorCodes.js';
import { WebSocketAPIError } from '../ProtocolHandler.js';
import { DefinedRoutes } from '../../routes/DefinedRoutes.js';
import { Routes } from '../../enums/Routes.js';
import { PackedMessage } from '../packets/APIPacket.js';
import {
    BlockHeaderAPIDocumentWithTransactions
} from '../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';

// Import typed request interfaces
import {
    BroadcastTransactionRequest,
    CallRequest,
    GetBalanceRequest,
    GetBlockByChecksumRequest,
    GetBlockByHashRequest,
    GetBlockByNumberRequest,
    GetBlockNumberRequest,
    GetBlockWitnessRequest,
    GetChainIdRequest,
    GetCodeRequest,
    GetEpochByHashRequest,
    GetEpochByNumberRequest,
    GetEpochTemplateRequest,
    GetGasRequest,
    GetLatestEpochRequest,
    GetPreimageRequest,
    GetPublicKeyInfoRequest,
    GetReorgRequest,
    GetStorageAtRequest,
    GetTransactionByHashRequest,
    GetTransactionReceiptRequest,
    GetUTXOsRequest,
    SubmitEpochRequest,
    SubscribeBlocksRequest,
    SubscribeEpochsRequest,
    UnsubscribeRequest,
} from '../types/requests/WebSocketRequestTypes.js';

// Import route classes for proper typing
import { LatestBlock } from '../../routes/api/v1/block/LatestBlock.js';
import { BlockByNumber } from '../../routes/api/v1/block/BlockByNumber.js';
import { BlockByHash } from '../../routes/api/v1/block/BlockByHash.js';
import { BlockByChecksum } from '../../routes/api/v1/block/BlockByChecksum.js';
import { OPNetWitnessRoute } from '../../routes/api/v1/opnet/OPNetWitnessRoute.js';
import { GasRoute } from '../../routes/api/v1/block/GasRoute.js';
import { TransactionByHash } from '../../routes/api/v1/transaction/TransactionByHash.js';
import { TransactionReceipt } from '../../routes/api/v1/transaction/TransactionReceipt.js';
import { BroadcastTransaction } from '../../routes/api/v1/transaction/BroadcastTransaction.js';
import { GetPreimage } from '../../routes/api/v1/transaction/GetPreimage.js';
import { GetBalanceRoute } from '../../routes/api/v1/address/GetBalanceRoute.js';
import { UTXOsRoute } from '../../routes/api/v1/address/UTXOsRoute.js';
import { PublicKeyInfoRoute } from '../../routes/api/v1/address/PublicKeyInfoRoute.js';
import { ChainId } from '../../routes/api/v1/chain/ChainId.js';
import { ReorgRoute } from '../../routes/api/v1/chain/ReorgRoute.js';
import { GetCode } from '../../routes/api/v1/states/GetCode.js';
import { GetStorageAt } from '../../routes/api/v1/states/GetStorageAt.js';
import { Call } from '../../routes/api/v1/states/Call.js';
import { LatestEpoch } from '../../routes/api/v1/epochs/LatestEpoch.js';
import { EpochByNumber } from '../../routes/api/v1/epochs/EpochByNumber.js';
import { EpochByHash } from '../../routes/api/v1/epochs/EpochByHash.js';
import { GetEpochTemplateRoute } from '../../routes/api/v1/epochs/GetEpochTemplateRoute.js';
import { SubmitEpochRoute } from '../../routes/api/v1/epochs/SubmitEpochRoute.js';
import { SubmissionStatus } from '../../json-rpc/types/interfaces/results/epochs/SubmittedEpochResult.js';

/**
 * Converts bigint to string for protobuf serialization (uint64 needs special handling)
 */
function bigintToNumber(value: bigint | string | undefined): number {
    if (value === undefined) return 0;
    if (typeof value === 'string') {
        // Handle hex strings
        if (value.startsWith('0x')) {
            return Number(BigInt(value));
        }
        return Number(value);
    }
    return Number(value);
}

/**
 * Parse a block identifier from the request
 */
function parseBlockIdentifier(
    identifier: { height?: number | bigint; hash?: string; checksum?: string } | undefined,
): { height?: bigint; hash?: string; checksum?: string } {
    if (!identifier) {
        return { height: -1n };
    }
    if (identifier.height !== undefined) {
        return { height: BigInt(identifier.height) };
    }
    if (identifier.hash) {
        return { hash: identifier.hash };
    }
    if (identifier.checksum) {
        return { checksum: identifier.checksum };
    }
    return { height: -1n };
}

/**
 * Convert block response to protobuf-compatible format
 */
function convertBlockResponse(block: BlockHeaderAPIDocumentWithTransactions): PackedMessage {
    return {
        ...block,
        time: typeof block.time === 'number' ? BigInt(block.time) : BigInt(0),
        medianTime: typeof block.medianTime === 'number' ? BigInt(block.medianTime) : BigInt(0),
        checksumProofs:
            block.checksumProofs?.map(([index, proofs]) => ({
                index,
                proofs,
            })) ?? [],
        transactions:
            block.transactions?.map((tx) => ({
                ...tx,
                raw: tx.raw ? Buffer.from(tx.raw) : Buffer.alloc(0),
            })) ?? [],
    };
}

/**
 * Handler registry that registers all WebSocket API handlers.
 * Handlers call existing route handlers to ensure consistent behavior with HTTP API.
 */
export class HandlerRegistry extends Logger {
    public readonly logColor: string = '#32cd32';

    public constructor() {
        super();
    }

    /**
     * Register all opcode handlers
     */
    public registerAll(): void {
        this.registerBlockHandlers();
        this.registerTransactionHandlers();
        this.registerAddressHandlers();
        this.registerChainHandlers();
        this.registerStateHandlers();
        this.registerEpochHandlers();
        this.registerSubscriptionHandlers();

        this.log('All WebSocket API handlers registered');

        // Validate all opcode handlers are registered
        APIRegistry.validateHandlers();
    }

    private registerBlockHandlers(): void {
        // GET_BLOCK_NUMBER - returns current block height
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_BLOCK_NUMBER,
            async (_request: PackedMessage<GetBlockNumberRequest>) => {
                const route = DefinedRoutes[Routes.LATEST_BLOCK] as LatestBlock;
                const result = await route.getData();
                // Result is a hex string like "0x123"
                const height = result ? BigInt(result) : 0n;
                return { blockNumber: height };
            },
        );

        // GET_BLOCK_BY_NUMBER
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_BLOCK_BY_NUMBER,
            async (request: PackedMessage<GetBlockByNumberRequest>) => {
                const route = DefinedRoutes[Routes.BLOCK_BY_ID] as BlockByNumber;
                const { height } = parseBlockIdentifier(request.identifier);
                const result = await route.getData({
                    height: height ?? -1n,
                    sendTransactions: request.includeTransactions ?? false,
                });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.BLOCK_NOT_FOUND);
                }

                return convertBlockResponse(result);
            },
        );

        // GET_BLOCK_BY_HASH
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_BLOCK_BY_HASH,
            async (request: PackedMessage<GetBlockByHashRequest>) => {
                const route = DefinedRoutes[Routes.BLOCK_BY_HASH] as BlockByHash;
                const { hash } = parseBlockIdentifier(request.identifier);
                const result = await route.getData({
                    blockHash: hash ?? '',
                    sendTransactions: request.includeTransactions ?? false,
                });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.BLOCK_NOT_FOUND);
                }

                return convertBlockResponse(result);
            },
        );

        // GET_BLOCK_BY_CHECKSUM
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_BLOCK_BY_CHECKSUM,
            async (request: PackedMessage<GetBlockByChecksumRequest>) => {
                const route = DefinedRoutes[Routes.BLOCK_BY_CHECKSUM] as BlockByChecksum;
                const { checksum } = parseBlockIdentifier(request.identifier);
                const result = await route.getData({
                    blockHash: checksum ?? '',
                    sendTransactions: request.includeTransactions ?? false,
                });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.BLOCK_NOT_FOUND);
                }

                return convertBlockResponse(result);
            },
        );

        // GET_BLOCK_WITNESS
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_BLOCK_WITNESS,
            async (request: PackedMessage<GetBlockWitnessRequest>) => {
                const route = DefinedRoutes[Routes.BLOCK_WITNESS] as OPNetWitnessRoute;
                const result = await route.getData({
                    height: BigInt(request.height),
                    trusted: request.trusted,
                    limit: request.limit,
                    page: request.page,
                });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.BLOCK_NOT_FOUND);
                }

                // Result is an array of { blockNumber, witnesses[] }
                return { entries: result };
            },
        );

        // GET_GAS
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_GAS,
            async (_request: PackedMessage<GetGasRequest>) => {
                const route = DefinedRoutes[Routes.GAS] as GasRoute;
                const result = await route.getData();

                if (!result) {
                    throw new WebSocketAPIError(InternalError.INTERNAL_ERROR);
                }

                return result;
            },
        );
    }

    private registerTransactionHandlers(): void {
        // GET_TRANSACTION_BY_HASH
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_TRANSACTION_BY_HASH,
            async (request: PackedMessage<GetTransactionByHashRequest>) => {
                const route = DefinedRoutes[Routes.TRANSACTION_BY_HASH] as TransactionByHash;
                const result = await route.getData({ hash: request.txHash });

                return { transaction: result ?? null };
            },
        );

        // GET_TRANSACTION_RECEIPT
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_TRANSACTION_RECEIPT,
            async (request: PackedMessage<GetTransactionReceiptRequest>) => {
                const route = DefinedRoutes[Routes.TRANSACTION_RECEIPT] as TransactionReceipt;
                const result = await route.getData({ hash: request.txHash });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.TRANSACTION_NOT_FOUND);
                }

                return result;
            },
        );

        // BROADCAST_TRANSACTION
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.BROADCAST_TRANSACTION,
            async (request: PackedMessage<BroadcastTransactionRequest>) => {
                const route = DefinedRoutes[Routes.BROADCAST_TRANSACTION] as BroadcastTransaction;
                const txHex = Buffer.isBuffer(request.transaction)
                    ? request.transaction.toString('hex')
                    : Buffer.from(request.transaction).toString('hex');

                const result = await route.getData({
                    data: txHex,
                    psbt: request.psbt,
                });

                if (!result) {
                    throw new WebSocketAPIError(InternalError.INTERNAL_ERROR);
                }

                return result;
            },
        );

        // GET_PREIMAGE - No params needed, returns cached preimage data
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_PREIMAGE,
            async (_request: PackedMessage<GetPreimageRequest>) => {
                const route = DefinedRoutes[Routes.TRANSACTION_PREIMAGE] as GetPreimage;
                const result = await route.getData();

                if (!result) {
                    throw new WebSocketAPIError(InternalError.INTERNAL_ERROR);
                }

                return result;
            },
        );
    }

    private registerAddressHandlers(): void {
        // GET_BALANCE
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_BALANCE,
            async (request: PackedMessage<GetBalanceRequest>) => {
                const route = DefinedRoutes[Routes.GET_BALANCE] as GetBalanceRoute;
                const result = await route.getData({
                    address: request.address,
                    filterOrdinals: request.filterOrdinals ?? false,
                });

                return { balance: result ?? '0' };
            },
        );

        // GET_UTXOS
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_UTXOS,
            async (request: PackedMessage<GetUTXOsRequest>) => {
                const route = DefinedRoutes[Routes.UTXOS] as UTXOsRoute;
                const result = await route.getData({
                    address: request.address,
                    optimize: request.optimize ?? false,
                });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.ADDRESS_NOT_FOUND);
                }

                // Convert bigint values in UTXOs to numbers for protobuf
                return {
                    confirmed:
                        result.confirmed?.map((u) => ({
                            ...u,
                            value: bigintToNumber(u.value),
                        })) ?? [],
                    spentTransactions: result.spentTransactions ?? [],
                    pending:
                        result.pending?.map((u) => ({
                            ...u,
                            value: bigintToNumber(u.value),
                        })) ?? [],
                    raw: result.raw ?? [],
                };
            },
        );

        // GET_PUBLIC_KEY_INFO
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_PUBLIC_KEY_INFO,
            async (request: PackedMessage<GetPublicKeyInfoRequest>) => {
                const route = DefinedRoutes[Routes.PUBLIC_KEY_INFO] as PublicKeyInfoRoute;
                // The route expects an array as the param
                const result = await route.getData([request.addresses]);

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.ADDRESS_NOT_FOUND);
                }

                // Convert to map format for protobuf
                const info: Record<string, PackedMessage> = {};
                for (const [address, data] of Object.entries(result)) {
                    if ('error' in data) {
                        info[address] = { error: data.error };
                    } else {
                        info[address] = { info: data };
                    }
                }

                return { info };
            },
        );
    }

    private registerChainHandlers(): void {
        // GET_CHAIN_ID
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_CHAIN_ID,
            (_request: PackedMessage<GetChainIdRequest>) => {
                const route = DefinedRoutes[Routes.CHAIN_ID] as ChainId;
                const result = route.getData();

                return { chainId: result ?? 'unknown' };
            },
        );

        // GET_REORG
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_REORG,
            async (request: PackedMessage<GetReorgRequest>) => {
                const route = DefinedRoutes[Routes.REORG] as ReorgRoute;
                const result = await route.getData({
                    fromBlock: request.fromBlock,
                    toBlock: request.toBlock,
                });

                return { reorgs: result ?? [] };
            },
        );
    }

    private registerStateHandlers(): void {
        // GET_CODE
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_CODE,
            async (request: PackedMessage<GetCodeRequest>) => {
                const route = DefinedRoutes[Routes.GET_CODE] as GetCode;
                // full=false means only bytecode, full=true means all contract info
                const result = await route.getData({
                    address: request.contractAddress,
                    onlyBytecode: !(request.full ?? false),
                });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.CONTRACT_NOT_FOUND);
                }

                return result;
            },
        );

        // GET_STORAGE_AT
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_STORAGE_AT,
            async (request: PackedMessage<GetStorageAtRequest>) => {
                const route = DefinedRoutes[Routes.GET_STORAGE_AT] as GetStorageAt;
                const result = await route.getData({
                    address: request.contractAddress,
                    pointer: request.pointer,
                    sendProofs: request.proofs ?? false,
                });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.CONTRACT_NOT_FOUND);
                }

                return result;
            },
        );

        // CALL
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.CALL,
            async (request: PackedMessage<CallRequest>) => {
                const route = DefinedRoutes[Routes.CALL] as Call;
                const result = await route.getData({
                    to: request.to,
                    calldata: request.calldata,
                    from: request.from,
                    fromLegacy: request.fromLegacy,
                });

                if (!result) {
                    throw new WebSocketAPIError(InternalError.VM_ERROR);
                }

                // Check if result is an error response
                if ('error' in result) {
                    return { error: result.error };
                }

                // Convert events map for protobuf
                const events: Record<string, { events: PackedMessage[] }> = {};
                if ('events' in result && result.events) {
                    for (const [addr, evts] of Object.entries(result.events)) {
                        events[addr] = { events: evts };
                    }
                }

                // Convert accessList map for protobuf
                const accessList: Record<string, { items: Record<string, string> }> = {};
                if ('accessList' in result && result.accessList) {
                    for (const [addr, items] of Object.entries(result.accessList)) {
                        accessList[addr] = { items };
                    }
                }

                // Convert loadedStorage map for protobuf
                const loadedStorage: Record<string, { pointers: string[] }> = {};
                if ('loadedStorage' in result && result.loadedStorage) {
                    for (const [addr, pointers] of Object.entries(result.loadedStorage)) {
                        loadedStorage[addr] = { pointers };
                    }
                }

                return {
                    data: {
                        result: result.result,
                        events,
                        revert: result.revert,
                        accessList,
                        loadedStorage,
                        estimatedGas: result.estimatedGas,
                        estimatedSpecialGas: result.estimatedSpecialGas,
                    },
                };
            },
        );
    }

    private registerEpochHandlers(): void {
        // GET_LATEST_EPOCH
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_LATEST_EPOCH,
            async (_request: PackedMessage<GetLatestEpochRequest>) => {
                const route = DefinedRoutes[Routes.LATEST_EPOCH] as LatestEpoch;
                const result = await route.getData();

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.EPOCH_NOT_FOUND);
                }

                return result;
            },
        );

        // GET_EPOCH_BY_NUMBER
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_EPOCH_BY_NUMBER,
            async (request: PackedMessage<GetEpochByNumberRequest>) => {
                const route = DefinedRoutes[Routes.EPOCH_BY_NUMBER] as EpochByNumber;
                const result = await route.getData({ height: BigInt(request.epochNumber) });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.EPOCH_NOT_FOUND);
                }

                return result;
            },
        );

        // GET_EPOCH_BY_HASH
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_EPOCH_BY_HASH,
            async (request: PackedMessage<GetEpochByHashRequest>) => {
                const route = DefinedRoutes[Routes.EPOCH_BY_HASH] as EpochByHash;
                const result = await route.getData({ hash: request.epochHash });

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.EPOCH_NOT_FOUND);
                }

                return result;
            },
        );

        // GET_EPOCH_TEMPLATE
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.GET_EPOCH_TEMPLATE,
            async (_request: PackedMessage<GetEpochTemplateRequest>) => {
                const route = DefinedRoutes[Routes.EPOCH_TEMPLATE] as GetEpochTemplateRoute;
                const result = await route.getData();

                if (!result) {
                    throw new WebSocketAPIError(ResourceError.EPOCH_NOT_FOUND);
                }

                return result;
            },
        );

        // SUBMIT_EPOCH
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.SUBMIT_EPOCH,
            async (request: PackedMessage<SubmitEpochRequest>) => {
                const route = DefinedRoutes[Routes.SUBMIT_EPOCH] as SubmitEpochRoute;
                const result = await route.getData({
                    epochNumber: request.epochNumber,
                    targetHash: request.targetHash,
                    salt: request.salt,
                    mldsaPublicKey: request.mldsaPublicKey,
                    graffiti: request.graffiti,
                    signature: request.signature,
                });

                if (!result) {
                    throw new WebSocketAPIError(InternalError.INTERNAL_ERROR);
                }

                // Convert status enum and return as object
                return {
                    epochNumber: result.epochNumber,
                    submissionHash: result.submissionHash,
                    difficulty: result.difficulty,
                    timestamp: BigInt(result.timestamp),
                    status: result.status === SubmissionStatus.ACCEPTED ? 0 : 1,
                    message: result.message,
                };
            },
        );
    }

    private registerSubscriptionHandlers(): void {
        // SUBSCRIBE_BLOCKS
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.SUBSCRIBE_BLOCKS,
            (
                _request: PackedMessage<SubscribeBlocksRequest>,
                _requestId: number,
                clientId: string,
            ) => {
                const client = WSManager.getClient(clientId);
                if (!client) {
                    throw new WebSocketAPIError(InternalError.INTERNAL_ERROR);
                }

                // Check if already subscribed
                if (client.hasSubscription(SubscriptionType.BLOCKS)) {
                    throw new WebSocketAPIError(ResourceError.SUBSCRIPTION_ALREADY_EXISTS);
                }

                const subscriptionId = client.addSubscription(SubscriptionType.BLOCKS);
                if (subscriptionId === null) {
                    throw new WebSocketAPIError(ResourceError.MAX_SUBSCRIPTIONS_REACHED);
                }

                return {
                    subscriptionId,
                    type: SubscriptionType.BLOCKS,
                };
            },
        );

        // SUBSCRIBE_EPOCHS
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.SUBSCRIBE_EPOCHS,
            (
                _request: PackedMessage<SubscribeEpochsRequest>,
                _requestId: number,
                clientId: string,
            ) => {
                const client = WSManager.getClient(clientId);
                if (!client) {
                    throw new WebSocketAPIError(InternalError.INTERNAL_ERROR);
                }

                // Check if already subscribed
                if (client.hasSubscription(SubscriptionType.EPOCHS)) {
                    throw new WebSocketAPIError(ResourceError.SUBSCRIPTION_ALREADY_EXISTS);
                }

                const subscriptionId = client.addSubscription(SubscriptionType.EPOCHS);
                if (subscriptionId === null) {
                    throw new WebSocketAPIError(ResourceError.MAX_SUBSCRIPTIONS_REACHED);
                }

                return {
                    subscriptionId,
                    type: SubscriptionType.EPOCHS,
                };
            },
        );

        // UNSUBSCRIBE
        APIRegistry.registerHandler(
            WebSocketRequestOpcode.UNSUBSCRIBE,
            (request: PackedMessage<UnsubscribeRequest>, _requestId: number, clientId: string) => {
                const client = WSManager.getClient(clientId);
                if (!client) {
                    throw new WebSocketAPIError(InternalError.INTERNAL_ERROR);
                }

                const subscription = client.getSubscription(request.subscriptionId);
                if (!subscription) {
                    throw new WebSocketAPIError(ResourceError.SUBSCRIPTION_NOT_FOUND);
                }

                const success = client.removeSubscription(request.subscriptionId);
                return { success };
            },
        );
    }
}

/**
 * Singleton instance of the handler registry
 */
export const Handlers: HandlerRegistry = new HandlerRegistry();
