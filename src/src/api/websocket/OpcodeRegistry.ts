import { Type } from 'protobufjs';
import { APIProtobufLoader } from './proto/APIProtobufLoader.js';
import { APIPacket, PackedMessage } from './packets/APIPacket.js';
import { APIPacketType } from './packets/types/APIPacketTypes.js';
import { OpcodeNames, WebSocketRequestOpcode, WebSocketResponseOpcode, } from './types/opcodes/WebSocketOpcodes.js';

/**
 * Handler function type for processing incoming requests.
 * Returns the response payload to be sent back to the client.
 */
export type OpcodeHandler<TReq, TRes> = (
    request: TReq,
    requestId: number,
    clientId: string,
) => Promise<TRes> | TRes;

/**
 * Registration for a request opcode handler
 */
interface OpcodeRegistration<TReq extends PackedMessage, TRes extends PackedMessage> {
    /** The packet class for deserializing requests */
    readonly requestPacket: APIPacket<TReq>;

    /** The packet class for serializing responses */
    readonly responsePacket: APIPacket<TRes>;

    /** The response opcode to use */
    readonly responseOpcode: WebSocketResponseOpcode;

    /** The handler function */
    handler: OpcodeHandler<TReq, TRes> | null;

    /** Whether this opcode requires handshake to be completed */
    readonly requiresHandshake: boolean;
}

/**
 * Generic packet builder type
 */
type PacketBuilder = APIPacket<PackedMessage, PackedMessage, PackedMessage>;

/**
 * Type for packet builders map
 */
type PacketBuilders = { [key in APIPacketType]?: PacketBuilder };

/**
 * Registry for WebSocket API opcodes and their handlers.
 * Follows the pattern established in the P2P PacketManager.
 */
export class OpcodeRegistry extends APIProtobufLoader {
    public override readonly logColor: string = '#4169e1';

    /**
     * Map of request opcodes to their registrations
     */
    private readonly requestHandlers: Map<
        WebSocketRequestOpcode,
        OpcodeRegistration<PackedMessage, PackedMessage>
    > = new Map();

    /**
     * Map of response opcodes to their packet builders
     */
    private readonly responsePackets: Map<WebSocketResponseOpcode, PacketBuilder> = new Map();

    /**
     * All packet builders keyed by type name
     */
    private readonly packetBuilders: PacketBuilders = {};

    /**
     * Set of opcodes that have been registered
     */
    private readonly registeredOpcodes: Set<number> = new Set();

    public constructor() {
        super();
        this.initializePacketBuilders();
        this.initializeOpcodeRegistrations();
    }

    /**
     * Get a packet builder by type name
     */
    public getPacketBuilder<T extends PackedMessage>(
        type: APIPacketType,
    ): APIPacket<T> | undefined {
        return this.packetBuilders[type] as APIPacket<T> | undefined;
    }

    /**
     * Get the registration for a request opcode
     */
    public getRequestRegistration(
        opcode: WebSocketRequestOpcode,
    ): OpcodeRegistration<PackedMessage, PackedMessage> | undefined {
        return this.requestHandlers.get(opcode);
    }

    /**
     * Get a response packet builder by opcode
     */
    public getResponsePacket(opcode: WebSocketResponseOpcode): PacketBuilder | undefined {
        return this.responsePackets.get(opcode);
    }

    /**
     * Register a handler for a request opcode
     */
    public registerHandler<TReq extends PackedMessage, TRes extends PackedMessage>(
        opcode: WebSocketRequestOpcode,
        handler: OpcodeHandler<TReq, TRes>,
    ): void {
        const registration = this.requestHandlers.get(opcode);
        if (!registration) {
            throw new Error(`No registration found for opcode ${OpcodeNames[opcode] ?? opcode}`);
        }

        if (registration.handler !== null) {
            this.warn(`Overwriting existing handler for opcode ${OpcodeNames[opcode] ?? opcode}`);
        }

        registration.handler = handler as unknown as OpcodeHandler<PackedMessage, PackedMessage>;
    }

    /**
     * Check if an opcode is registered
     */
    public isOpcodeRegistered(opcode: number): boolean {
        return this.registeredOpcodes.has(opcode);
    }

    /**
     * Check if a request opcode requires handshake
     */
    public requiresHandshake(opcode: WebSocketRequestOpcode): boolean {
        const registration = this.requestHandlers.get(opcode);
        return registration?.requiresHandshake ?? true;
    }

    /**
     * Validate that all opcodes have handlers registered
     */
    public validateHandlers(): void {
        const missingHandlers: string[] = [];

        for (const [opcode, registration] of this.requestHandlers) {
            if (registration.handler === null) {
                missingHandlers.push(OpcodeNames[opcode] ?? `0x${opcode.toString(16)}`);
            }
        }

        if (missingHandlers.length > 0) {
            this.warn(`Missing handlers for opcodes: ${missingHandlers.join(', ')}`);
        }
    }

    /**
     * Get the protobuf type for a packet type name
     */
    private getType(typeName: APIPacketType): Type {
        return this.getProtobufType(typeName);
    }

    /**
     * Create a generic packet builder
     */
    private createPacket<T extends PackedMessage>(
        typeName: APIPacketType,
        opcode: WebSocketRequestOpcode | WebSocketResponseOpcode | null = null,
    ): APIPacket<T> {
        return new GenericAPIPacket<T>(this.getType(typeName), opcode);
    }

    /**
     * Initialize all packet builders
     */
    private initializePacketBuilders(): void {
        // Handshake
        this.packetBuilders[APIPacketType.HandshakeRequest] = this.createPacket(
            APIPacketType.HandshakeRequest,
            WebSocketRequestOpcode.HANDSHAKE,
        );
        this.packetBuilders[APIPacketType.HandshakeResponse] = this.createPacket(
            APIPacketType.HandshakeResponse,
            WebSocketResponseOpcode.HANDSHAKE_ACK,
        );

        // Error
        this.packetBuilders[APIPacketType.ErrorResponse] = this.createPacket(
            APIPacketType.ErrorResponse,
            WebSocketResponseOpcode.ERROR,
        );

        // Ping/Pong
        this.packetBuilders[APIPacketType.PingRequest] = this.createPacket(
            APIPacketType.PingRequest,
            WebSocketRequestOpcode.PING,
        );
        this.packetBuilders[APIPacketType.PongResponse] = this.createPacket(
            APIPacketType.PongResponse,
            WebSocketResponseOpcode.PONG,
        );

        // Blocks
        this.packetBuilders[APIPacketType.GetBlockNumberRequest] = this.createPacket(
            APIPacketType.GetBlockNumberRequest,
            WebSocketRequestOpcode.GET_BLOCK_NUMBER,
        );
        this.packetBuilders[APIPacketType.GetBlockNumberResponse] = this.createPacket(
            APIPacketType.GetBlockNumberResponse,
            WebSocketResponseOpcode.BLOCK_NUMBER,
        );
        this.packetBuilders[APIPacketType.GetBlockByNumberRequest] = this.createPacket(
            APIPacketType.GetBlockByNumberRequest,
            WebSocketRequestOpcode.GET_BLOCK_BY_NUMBER,
        );
        this.packetBuilders[APIPacketType.BlockResponse] = this.createPacket(
            APIPacketType.BlockResponse,
            WebSocketResponseOpcode.BLOCK,
        );
        this.packetBuilders[APIPacketType.GetBlockWitnessRequest] = this.createPacket(
            APIPacketType.GetBlockWitnessRequest,
            WebSocketRequestOpcode.GET_BLOCK_WITNESS,
        );
        this.packetBuilders[APIPacketType.BlockWitnessResponse] = this.createPacket(
            APIPacketType.BlockWitnessResponse,
            WebSocketResponseOpcode.BLOCK_WITNESS,
        );
        this.packetBuilders[APIPacketType.GetGasRequest] = this.createPacket(
            APIPacketType.GetGasRequest,
            WebSocketRequestOpcode.GET_GAS,
        );
        this.packetBuilders[APIPacketType.GasResponse] = this.createPacket(
            APIPacketType.GasResponse,
            WebSocketResponseOpcode.GAS,
        );

        // Transactions
        this.packetBuilders[APIPacketType.GetTransactionByHashRequest] = this.createPacket(
            APIPacketType.GetTransactionByHashRequest,
            WebSocketRequestOpcode.GET_TRANSACTION_BY_HASH,
        );
        this.packetBuilders[APIPacketType.TransactionResponse] = this.createPacket(
            APIPacketType.TransactionResponse,
            WebSocketResponseOpcode.TRANSACTION,
        );
        this.packetBuilders[APIPacketType.GetTransactionReceiptRequest] = this.createPacket(
            APIPacketType.GetTransactionReceiptRequest,
            WebSocketRequestOpcode.GET_TRANSACTION_RECEIPT,
        );
        this.packetBuilders[APIPacketType.TransactionReceiptResponse] = this.createPacket(
            APIPacketType.TransactionReceiptResponse,
            WebSocketResponseOpcode.TRANSACTION_RECEIPT,
        );
        this.packetBuilders[APIPacketType.BroadcastTransactionRequest] = this.createPacket(
            APIPacketType.BroadcastTransactionRequest,
            WebSocketRequestOpcode.BROADCAST_TRANSACTION,
        );
        this.packetBuilders[APIPacketType.BroadcastTransactionResponse] = this.createPacket(
            APIPacketType.BroadcastTransactionResponse,
            WebSocketResponseOpcode.BROADCAST_RESULT,
        );
        this.packetBuilders[APIPacketType.GetPreimageRequest] = this.createPacket(
            APIPacketType.GetPreimageRequest,
            WebSocketRequestOpcode.GET_PREIMAGE,
        );
        this.packetBuilders[APIPacketType.PreimageResponse] = this.createPacket(
            APIPacketType.PreimageResponse,
            WebSocketResponseOpcode.PREIMAGE,
        );

        // Addresses
        this.packetBuilders[APIPacketType.GetBalanceRequest] = this.createPacket(
            APIPacketType.GetBalanceRequest,
            WebSocketRequestOpcode.GET_BALANCE,
        );
        this.packetBuilders[APIPacketType.GetBalanceResponse] = this.createPacket(
            APIPacketType.GetBalanceResponse,
            WebSocketResponseOpcode.BALANCE,
        );
        this.packetBuilders[APIPacketType.GetUTXOsRequest] = this.createPacket(
            APIPacketType.GetUTXOsRequest,
            WebSocketRequestOpcode.GET_UTXOS,
        );
        this.packetBuilders[APIPacketType.GetUTXOsResponse] = this.createPacket(
            APIPacketType.GetUTXOsResponse,
            WebSocketResponseOpcode.UTXOS,
        );
        this.packetBuilders[APIPacketType.GetPublicKeyInfoRequest] = this.createPacket(
            APIPacketType.GetPublicKeyInfoRequest,
            WebSocketRequestOpcode.GET_PUBLIC_KEY_INFO,
        );
        this.packetBuilders[APIPacketType.GetPublicKeyInfoResponse] = this.createPacket(
            APIPacketType.GetPublicKeyInfoResponse,
            WebSocketResponseOpcode.PUBLIC_KEY_INFO,
        );

        // Chain
        this.packetBuilders[APIPacketType.GetChainIdRequest] = this.createPacket(
            APIPacketType.GetChainIdRequest,
            WebSocketRequestOpcode.GET_CHAIN_ID,
        );
        this.packetBuilders[APIPacketType.GetChainIdResponse] = this.createPacket(
            APIPacketType.GetChainIdResponse,
            WebSocketResponseOpcode.CHAIN_ID,
        );
        this.packetBuilders[APIPacketType.GetReorgRequest] = this.createPacket(
            APIPacketType.GetReorgRequest,
            WebSocketRequestOpcode.GET_REORG,
        );
        this.packetBuilders[APIPacketType.GetReorgResponse] = this.createPacket(
            APIPacketType.GetReorgResponse,
            WebSocketResponseOpcode.REORG,
        );

        // States
        this.packetBuilders[APIPacketType.GetCodeRequest] = this.createPacket(
            APIPacketType.GetCodeRequest,
            WebSocketRequestOpcode.GET_CODE,
        );
        this.packetBuilders[APIPacketType.GetCodeResponse] = this.createPacket(
            APIPacketType.GetCodeResponse,
            WebSocketResponseOpcode.CODE,
        );
        this.packetBuilders[APIPacketType.GetStorageAtRequest] = this.createPacket(
            APIPacketType.GetStorageAtRequest,
            WebSocketRequestOpcode.GET_STORAGE_AT,
        );
        this.packetBuilders[APIPacketType.GetStorageAtResponse] = this.createPacket(
            APIPacketType.GetStorageAtResponse,
            WebSocketResponseOpcode.STORAGE,
        );
        this.packetBuilders[APIPacketType.CallRequest] = this.createPacket(
            APIPacketType.CallRequest,
            WebSocketRequestOpcode.CALL,
        );
        this.packetBuilders[APIPacketType.CallResponse] = this.createPacket(
            APIPacketType.CallResponse,
            WebSocketResponseOpcode.CALL_RESULT,
        );

        // Epochs
        this.packetBuilders[APIPacketType.GetLatestEpochRequest] = this.createPacket(
            APIPacketType.GetLatestEpochRequest,
            WebSocketRequestOpcode.GET_LATEST_EPOCH,
        );
        this.packetBuilders[APIPacketType.EpochResponse] = this.createPacket(
            APIPacketType.EpochResponse,
            WebSocketResponseOpcode.EPOCH,
        );
        this.packetBuilders[APIPacketType.GetEpochByNumberRequest] = this.createPacket(
            APIPacketType.GetEpochByNumberRequest,
            WebSocketRequestOpcode.GET_EPOCH_BY_NUMBER,
        );
        this.packetBuilders[APIPacketType.GetEpochByHashRequest] = this.createPacket(
            APIPacketType.GetEpochByHashRequest,
            WebSocketRequestOpcode.GET_EPOCH_BY_HASH,
        );
        this.packetBuilders[APIPacketType.GetEpochTemplateRequest] = this.createPacket(
            APIPacketType.GetEpochTemplateRequest,
            WebSocketRequestOpcode.GET_EPOCH_TEMPLATE,
        );
        this.packetBuilders[APIPacketType.EpochTemplateResponse] = this.createPacket(
            APIPacketType.EpochTemplateResponse,
            WebSocketResponseOpcode.EPOCH_TEMPLATE,
        );
        this.packetBuilders[APIPacketType.SubmitEpochRequest] = this.createPacket(
            APIPacketType.SubmitEpochRequest,
            WebSocketRequestOpcode.SUBMIT_EPOCH,
        );
        this.packetBuilders[APIPacketType.SubmitEpochResponse] = this.createPacket(
            APIPacketType.SubmitEpochResponse,
            WebSocketResponseOpcode.EPOCH_SUBMIT_RESULT,
        );

        // Mempool
        this.packetBuilders[APIPacketType.GetMempoolInfoRequest] = this.createPacket(
            APIPacketType.GetMempoolInfoRequest,
            WebSocketRequestOpcode.GET_MEMPOOL_INFO,
        );
        this.packetBuilders[APIPacketType.GetMempoolInfoResponse] = this.createPacket(
            APIPacketType.GetMempoolInfoResponse,
            WebSocketResponseOpcode.MEMPOOL_INFO,
        );
        this.packetBuilders[APIPacketType.GetPendingTransactionRequest] = this.createPacket(
            APIPacketType.GetPendingTransactionRequest,
            WebSocketRequestOpcode.GET_PENDING_TRANSACTION,
        );
        this.packetBuilders[APIPacketType.PendingTransactionResponse] = this.createPacket(
            APIPacketType.PendingTransactionResponse,
            WebSocketResponseOpcode.PENDING_TRANSACTION,
        );
        this.packetBuilders[APIPacketType.GetLatestPendingTransactionsRequest] = this.createPacket(
            APIPacketType.GetLatestPendingTransactionsRequest,
            WebSocketRequestOpcode.GET_LATEST_PENDING_TRANSACTIONS,
        );
        this.packetBuilders[APIPacketType.LatestPendingTransactionsResponse] = this.createPacket(
            APIPacketType.LatestPendingTransactionsResponse,
            WebSocketResponseOpcode.LATEST_PENDING_TRANSACTIONS,
        );

        // Subscriptions
        this.packetBuilders[APIPacketType.SubscribeBlocksRequest] = this.createPacket(
            APIPacketType.SubscribeBlocksRequest,
            WebSocketRequestOpcode.SUBSCRIBE_BLOCKS,
        );
        this.packetBuilders[APIPacketType.SubscribeBlocksResponse] = this.createPacket(
            APIPacketType.SubscribeBlocksResponse,
            WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
        );
        this.packetBuilders[APIPacketType.SubscribeEpochsRequest] = this.createPacket(
            APIPacketType.SubscribeEpochsRequest,
            WebSocketRequestOpcode.SUBSCRIBE_EPOCHS,
        );
        this.packetBuilders[APIPacketType.SubscribeEpochsResponse] = this.createPacket(
            APIPacketType.SubscribeEpochsResponse,
            WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
        );
        this.packetBuilders[APIPacketType.SubscribeMempoolRequest] = this.createPacket(
            APIPacketType.SubscribeMempoolRequest,
            WebSocketRequestOpcode.SUBSCRIBE_MEMPOOL,
        );
        this.packetBuilders[APIPacketType.SubscribeMempoolResponse] = this.createPacket(
            APIPacketType.SubscribeMempoolResponse,
            WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
        );
        this.packetBuilders[APIPacketType.UnsubscribeRequest] = this.createPacket(
            APIPacketType.UnsubscribeRequest,
            WebSocketRequestOpcode.UNSUBSCRIBE,
        );
        this.packetBuilders[APIPacketType.UnsubscribeResponse] = this.createPacket(
            APIPacketType.UnsubscribeResponse,
            WebSocketResponseOpcode.UNSUBSCRIBE_RESULT,
        );

        // Notifications
        this.packetBuilders[APIPacketType.NewBlockNotification] = this.createPacket(
            APIPacketType.NewBlockNotification,
            WebSocketResponseOpcode.NEW_BLOCK_NOTIFICATION,
        );
        this.packetBuilders[APIPacketType.NewEpochNotification] = this.createPacket(
            APIPacketType.NewEpochNotification,
            WebSocketResponseOpcode.NEW_EPOCH_NOTIFICATION,
        );
        this.packetBuilders[APIPacketType.NewMempoolTransactionNotification] = this.createPacket(
            APIPacketType.NewMempoolTransactionNotification,
            WebSocketResponseOpcode.NEW_MEMPOOL_TX_NOTIFICATION,
        );

        // Register response packets
        for (const packet of Object.values(this.packetBuilders)) {
            if (packet) {
                try {
                    const opcode = packet.getOpcode();
                    if (opcode >= WebSocketResponseOpcode.ERROR) {
                        this.responsePackets.set(opcode as WebSocketResponseOpcode, packet);
                    }
                } catch {
                    // Packet has no opcode, skip
                    this.warn(
                        `Packet has no opcode, skipping registration in response packets map.`,
                    );
                }
            }
        }
    }

    /**
     * Initialize opcode registrations
     */
    private initializeOpcodeRegistrations(): void {
        // Helper to register a request opcode
        const register = <TReq extends PackedMessage, TRes extends PackedMessage>(
            opcode: WebSocketRequestOpcode,
            requestType: APIPacketType,
            responseType: APIPacketType,
            responseOpcode: WebSocketResponseOpcode,
            requiresHandshake: boolean = true,
        ): void => {
            if (this.registeredOpcodes.has(opcode)) {
                throw new Error(
                    `Opcode collision: ${OpcodeNames[opcode]} (0x${opcode.toString(16)})`,
                );
            }

            const requestPacket = this.packetBuilders[requestType] as APIPacket<TReq> | undefined;
            const responsePacket = this.packetBuilders[responseType] as APIPacket<TRes> | undefined;

            if (!requestPacket || !responsePacket) {
                throw new Error(`Missing packet builder for ${requestType} or ${responseType}`);
            }

            this.requestHandlers.set(opcode, {
                requestPacket: requestPacket as APIPacket<PackedMessage>,
                responsePacket: responsePacket as APIPacket<PackedMessage>,
                responseOpcode,
                handler: null,
                requiresHandshake,
            });

            this.registeredOpcodes.add(opcode);
        };

        // Register all opcodes
        // Connection management (no handshake required for these)
        register(
            WebSocketRequestOpcode.PING,
            APIPacketType.PingRequest,
            APIPacketType.PongResponse,
            WebSocketResponseOpcode.PONG,
            false,
        );
        register(
            WebSocketRequestOpcode.HANDSHAKE,
            APIPacketType.HandshakeRequest,
            APIPacketType.HandshakeResponse,
            WebSocketResponseOpcode.HANDSHAKE_ACK,
            false,
        );

        // Blocks
        register(
            WebSocketRequestOpcode.GET_BLOCK_NUMBER,
            APIPacketType.GetBlockNumberRequest,
            APIPacketType.GetBlockNumberResponse,
            WebSocketResponseOpcode.BLOCK_NUMBER,
        );
        register(
            WebSocketRequestOpcode.GET_BLOCK_BY_NUMBER,
            APIPacketType.GetBlockByNumberRequest,
            APIPacketType.BlockResponse,
            WebSocketResponseOpcode.BLOCK,
        );
        register(
            WebSocketRequestOpcode.GET_BLOCK_BY_HASH,
            APIPacketType.GetBlockByNumberRequest,
            APIPacketType.BlockResponse,
            WebSocketResponseOpcode.BLOCK,
        );
        register(
            WebSocketRequestOpcode.GET_BLOCK_BY_CHECKSUM,
            APIPacketType.GetBlockByNumberRequest,
            APIPacketType.BlockResponse,
            WebSocketResponseOpcode.BLOCK,
        );
        register(
            WebSocketRequestOpcode.GET_BLOCK_WITNESS,
            APIPacketType.GetBlockWitnessRequest,
            APIPacketType.BlockWitnessResponse,
            WebSocketResponseOpcode.BLOCK_WITNESS,
        );
        register(
            WebSocketRequestOpcode.GET_GAS,
            APIPacketType.GetGasRequest,
            APIPacketType.GasResponse,
            WebSocketResponseOpcode.GAS,
        );

        // Transactions
        register(
            WebSocketRequestOpcode.GET_TRANSACTION_BY_HASH,
            APIPacketType.GetTransactionByHashRequest,
            APIPacketType.TransactionResponse,
            WebSocketResponseOpcode.TRANSACTION,
        );
        register(
            WebSocketRequestOpcode.GET_TRANSACTION_RECEIPT,
            APIPacketType.GetTransactionReceiptRequest,
            APIPacketType.TransactionReceiptResponse,
            WebSocketResponseOpcode.TRANSACTION_RECEIPT,
        );
        register(
            WebSocketRequestOpcode.BROADCAST_TRANSACTION,
            APIPacketType.BroadcastTransactionRequest,
            APIPacketType.BroadcastTransactionResponse,
            WebSocketResponseOpcode.BROADCAST_RESULT,
        );
        register(
            WebSocketRequestOpcode.GET_PREIMAGE,
            APIPacketType.GetPreimageRequest,
            APIPacketType.PreimageResponse,
            WebSocketResponseOpcode.PREIMAGE,
        );

        // Mempool
        register(
            WebSocketRequestOpcode.GET_MEMPOOL_INFO,
            APIPacketType.GetMempoolInfoRequest,
            APIPacketType.GetMempoolInfoResponse,
            WebSocketResponseOpcode.MEMPOOL_INFO,
        );
        register(
            WebSocketRequestOpcode.GET_PENDING_TRANSACTION,
            APIPacketType.GetPendingTransactionRequest,
            APIPacketType.PendingTransactionResponse,
            WebSocketResponseOpcode.PENDING_TRANSACTION,
        );
        register(
            WebSocketRequestOpcode.GET_LATEST_PENDING_TRANSACTIONS,
            APIPacketType.GetLatestPendingTransactionsRequest,
            APIPacketType.LatestPendingTransactionsResponse,
            WebSocketResponseOpcode.LATEST_PENDING_TRANSACTIONS,
        );

        // Addresses
        register(
            WebSocketRequestOpcode.GET_BALANCE,
            APIPacketType.GetBalanceRequest,
            APIPacketType.GetBalanceResponse,
            WebSocketResponseOpcode.BALANCE,
        );
        register(
            WebSocketRequestOpcode.GET_UTXOS,
            APIPacketType.GetUTXOsRequest,
            APIPacketType.GetUTXOsResponse,
            WebSocketResponseOpcode.UTXOS,
        );
        register(
            WebSocketRequestOpcode.GET_PUBLIC_KEY_INFO,
            APIPacketType.GetPublicKeyInfoRequest,
            APIPacketType.GetPublicKeyInfoResponse,
            WebSocketResponseOpcode.PUBLIC_KEY_INFO,
        );

        // Chain
        register(
            WebSocketRequestOpcode.GET_CHAIN_ID,
            APIPacketType.GetChainIdRequest,
            APIPacketType.GetChainIdResponse,
            WebSocketResponseOpcode.CHAIN_ID,
        );
        register(
            WebSocketRequestOpcode.GET_REORG,
            APIPacketType.GetReorgRequest,
            APIPacketType.GetReorgResponse,
            WebSocketResponseOpcode.REORG,
        );

        // States
        register(
            WebSocketRequestOpcode.GET_CODE,
            APIPacketType.GetCodeRequest,
            APIPacketType.GetCodeResponse,
            WebSocketResponseOpcode.CODE,
        );
        register(
            WebSocketRequestOpcode.GET_STORAGE_AT,
            APIPacketType.GetStorageAtRequest,
            APIPacketType.GetStorageAtResponse,
            WebSocketResponseOpcode.STORAGE,
        );

        register(
            WebSocketRequestOpcode.CALL,
            APIPacketType.CallRequest,
            APIPacketType.CallResponse,
            WebSocketResponseOpcode.CALL_RESULT,
        );

        // Epochs
        register(
            WebSocketRequestOpcode.GET_LATEST_EPOCH,
            APIPacketType.GetLatestEpochRequest,
            APIPacketType.EpochResponse,
            WebSocketResponseOpcode.EPOCH,
        );
        register(
            WebSocketRequestOpcode.GET_EPOCH_BY_NUMBER,
            APIPacketType.GetEpochByNumberRequest,
            APIPacketType.EpochResponse,
            WebSocketResponseOpcode.EPOCH,
        );
        register(
            WebSocketRequestOpcode.GET_EPOCH_BY_HASH,
            APIPacketType.GetEpochByHashRequest,
            APIPacketType.EpochResponse,
            WebSocketResponseOpcode.EPOCH,
        );
        register(
            WebSocketRequestOpcode.GET_EPOCH_TEMPLATE,
            APIPacketType.GetEpochTemplateRequest,
            APIPacketType.EpochTemplateResponse,
            WebSocketResponseOpcode.EPOCH_TEMPLATE,
        );
        register(
            WebSocketRequestOpcode.SUBMIT_EPOCH,
            APIPacketType.SubmitEpochRequest,
            APIPacketType.SubmitEpochResponse,
            WebSocketResponseOpcode.EPOCH_SUBMIT_RESULT,
        );

        // Subscriptions
        register(
            WebSocketRequestOpcode.SUBSCRIBE_BLOCKS,
            APIPacketType.SubscribeBlocksRequest,
            APIPacketType.SubscribeBlocksResponse,
            WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
        );
        register(
            WebSocketRequestOpcode.SUBSCRIBE_EPOCHS,
            APIPacketType.SubscribeEpochsRequest,
            APIPacketType.SubscribeEpochsResponse,
            WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
        );
        register(
            WebSocketRequestOpcode.SUBSCRIBE_MEMPOOL,
            APIPacketType.SubscribeMempoolRequest,
            APIPacketType.SubscribeMempoolResponse,
            WebSocketResponseOpcode.SUBSCRIPTION_CREATED,
        );
        register(
            WebSocketRequestOpcode.UNSUBSCRIBE,
            APIPacketType.UnsubscribeRequest,
            APIPacketType.UnsubscribeResponse,
            WebSocketResponseOpcode.UNSUBSCRIBE_RESULT,
        );
    }
}

/**
 * Generic packet implementation for dynamic packet types
 */
class GenericAPIPacket<T extends PackedMessage> extends APIPacket<T, T, T> {
    public constructor(
        protobufType: Type,
        opcode: WebSocketRequestOpcode | WebSocketResponseOpcode | null = null,
    ) {
        super(protobufType, opcode);
    }
}

/**
 * Singleton instance of the opcode registry
 */
export const APIRegistry: OpcodeRegistry = new OpcodeRegistry();
