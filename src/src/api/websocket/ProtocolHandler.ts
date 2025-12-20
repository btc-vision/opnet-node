import { Logger } from '@btc-vision/bsi-common';
import { WebSocketClient } from './WebSocketClient.js';
import { APIRegistry } from './OpcodeRegistry.js';
import { parseWebSocketMessage } from './packets/APIPacket.js';
import { OpcodeNames, WebSocketRequestOpcode } from './types/opcodes/WebSocketOpcodes.js';
import {
    InternalError,
    ProtocolError,
    ValidationError,
    WebSocketErrorCode,
} from './types/errors/WebSocketErrorCodes.js';
import { APIPacketType } from './packets/types/APIPacketTypes.js';
import { WSManager } from './WebSocketManager.js';
import type { PluginOpcodeRegistry } from '../../plugins/api/websocket/PluginOpcodeRegistry.js';
import { Config } from '../../config/Config.js';

/**
 * Current protocol version
 */
export const PROTOCOL_VERSION = 1;

/**
 * Minimum supported protocol version
 */
export const MIN_PROTOCOL_VERSION = 1;

/**
 * Maximum supported protocol version
 */
export const MAX_PROTOCOL_VERSION = 1;

/**
 * Handles the WebSocket binary protocol.
 * Routes messages by opcode, handles serialization/deserialization,
 * and enforces protocol rules.
 */
export class ProtocolHandler extends Logger {
    public readonly logColor: string = '#9370db';

    /** Plugin opcode registry (optional, set by WebSocketManager) */
    private pluginRegistry: PluginOpcodeRegistry | undefined;

    public constructor() {
        super();
    }

    /**
     * Set the plugin opcode registry
     */
    public setPluginRegistry(registry: PluginOpcodeRegistry): void {
        this.pluginRegistry = registry;
        this.log('Plugin opcode registry registered');
    }

    /**
     * Process an incoming binary message from a client.
     * Returns true if message was handled successfully.
     */
    public async processMessage(client: WebSocketClient, raw: Uint8Array): Promise<boolean> {
        // Parse opcode and payload
        let opcode: WebSocketRequestOpcode;
        let payload: Buffer;

        try {
            const parsed = parseWebSocketMessage(raw);
            opcode = parsed.opcode as WebSocketRequestOpcode;
            payload = parsed.payload;
        } catch (error) {
            if (Config.DEV_MODE && Config.DEV.DEBUG_API_ERRORS) {
                this.error(`Failed to parse message from client ${client.clientId}: ${error}`);
            }

            client.closeWithError(ProtocolError.MALFORMED_MESSAGE);
            return false;
        }

        // Check if it's a plugin opcode
        if (this.pluginRegistry && this.pluginRegistry.isPluginOpcode(opcode)) {
            return this.handlePluginOpcode(client, opcode, payload);
        }

        // Check if opcode is registered in core registry
        if (!APIRegistry.isOpcodeRegistered(opcode)) {
            const opcodeName = OpcodeNames[opcode] ?? `0x${opcode.toString(16)}`;
            this.warn(`Unknown opcode ${opcodeName} from client ${client.clientId}`);
            client.closeWithError(ProtocolError.UNKNOWN_OPCODE);
            return false;
        }

        // Get the registration
        const registration = APIRegistry.getRequestRegistration(opcode);
        if (!registration) {
            client.closeWithError(ProtocolError.UNKNOWN_OPCODE);
            return false;
        }

        // Check handshake requirement
        if (registration.requiresHandshake && !client.isHandshakeCompleted()) {
            client.sendError(0, ProtocolError.HANDSHAKE_REQUIRED);
            client.close(1002, 'Handshake required');
            return false;
        }

        // Handle ping specially (no request ID)
        if (opcode === WebSocketRequestOpcode.PING) {
            return this.handlePing(client, payload);
        }

        // Handle handshake specially
        if (opcode === WebSocketRequestOpcode.HANDSHAKE) {
            return this.handleHandshake(client, payload);
        }

        // Client sends [requestId (4 bytes LE)] [protobuf payload]
        if (payload.length < 4) {
            client.sendError(0, ProtocolError.MALFORMED_MESSAGE);
            return false;
        }

        // Extract requestId from first 4 bytes (little-endian)
        const requestId = payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24);
        const protobufPayload = payload.subarray(4);

        // Deserialize the protobuf payload
        let request: Record<string, unknown>;
        try {
            request = registration.requestPacket.unpack(protobufPayload) as Record<string, unknown>;
        } catch (error) {
            const opcodeName =
                OpcodeNames[opcode as WebSocketRequestOpcode] ?? `0x${opcode.toString(16)}`;
            this.warn(`Failed to deserialize ${opcodeName}: ${error}`);
            client.sendError(requestId, ProtocolError.MALFORMED_MESSAGE, 'Failed to deserialize request');
            return false;
        }

        // Check rate limit and pending requests
        if (!client.startRequest()) {
            client.sendError(requestId, ProtocolError.TOO_MANY_PENDING_REQUESTS);
            return false;
        }

        try {
            // Check if handler is registered
            if (!registration.handler) {
                client.sendError(requestId, InternalError.NOT_IMPLEMENTED);
                return false;
            }

            // Execute the handler
            const response = await registration.handler(request, requestId, client.clientId);

            // Serialize and send response with requestId
            const responsePayload = registration.responsePacket.packPayload(response);
            client.sendResponse(registration.responseOpcode, requestId, responsePayload);

            return true;
        } catch (error) {
            this.handleError(client, requestId, error);
            return false;
        } finally {
            client.endRequest();
        }
    }

    /**
     * Handle ping request
     */
    private handlePing(client: WebSocketClient, payload: Buffer): boolean {
        try {
            const pingPacket = APIRegistry.getPacketBuilder(APIPacketType.PingRequest);
            const pongPacket = APIRegistry.getPacketBuilder(APIPacketType.PongResponse);

            if (!pingPacket || !pongPacket) {
                return false;
            }

            // Client sends [requestId (4 bytes)] [protobuf payload]
            if (payload.length < 4) {
                return false;
            }

            // Extract requestId to echo back in response
            const requestId = payload.subarray(0, 4);
            const protobufPayload = payload.subarray(4);

            const pingData = pingPacket.unpack(protobufPayload) as { timestamp: bigint | number };
            const pongData = {
                timestamp: pingData.timestamp,
                serverTimestamp: BigInt(Date.now()),
            };

            // Response format: [opcode (1)] [requestId (4)] [protobuf payload]
            const packedPayload = pongPacket.packPayload(pongData);
            const fullResponse = new Uint8Array(1 + 4 + packedPayload.length);
            fullResponse[0] = pongPacket.getOpcode();
            fullResponse.set(requestId, 1);
            fullResponse.set(packedPayload, 5);
            client.send(fullResponse);

            return true;
        } catch (error) {
            this.warn(`Failed to handle ping: ${error}`);
            return false;
        }
    }

    /**
     * Handle handshake request
     */
    private handleHandshake(client: WebSocketClient, payload: Buffer): boolean {
        try {
            // Check if already handshaked
            if (client.isHandshakeCompleted()) {
                client.sendError(0, ProtocolError.HANDSHAKE_ALREADY_COMPLETED);
                return false;
            }

            const handshakePacket = APIRegistry.getPacketBuilder(APIPacketType.HandshakeRequest);
            const responsePacket = APIRegistry.getPacketBuilder(APIPacketType.HandshakeResponse);

            if (!handshakePacket || !responsePacket) {
                client.closeWithError(InternalError.INTERNAL_ERROR);
                return false;
            }

            // Client sends [requestId (4 bytes)] [protobuf payload]
            if (payload.length < 4) {
                client.closeWithError(ProtocolError.MALFORMED_MESSAGE);
                return false;
            }

            // Extract requestId to echo back in response
            const requestId = payload.subarray(0, 4);
            const protobufPayload = payload.subarray(4);

            const handshakeData = handshakePacket.unpack(protobufPayload) as {
                protocolVersion: number;
                clientName: string;
                clientVersion: string;
            };

            // Validate protocol version
            if (
                handshakeData.protocolVersion < MIN_PROTOCOL_VERSION ||
                handshakeData.protocolVersion > MAX_PROTOCOL_VERSION
            ) {
                client.sendError(0, ProtocolError.UNSUPPORTED_PROTOCOL_VERSION);
                client.close(1002, 'Unsupported protocol version');
                return false;
            }

            // Validate client info
            if (!handshakeData.clientName || handshakeData.clientName.length > 64) {
                client.sendError(0, ValidationError.INVALID_PARAMS, 'Invalid client name');
                client.close(1002, 'Invalid client info');
                return false;
            }

            // Complete handshake
            client.completeHandshake(
                handshakeData.protocolVersion,
                handshakeData.clientName,
                handshakeData.clientVersion ?? '0.0.0',
            );

            // Send response with dynamic data from WSManager
            const response = {
                protocolVersion: PROTOCOL_VERSION,
                sessionId: Buffer.from(client.clientId, 'hex'),
                serverVersion: WSManager.getServerVersion(),
                currentBlockHeight: WSManager.getCurrentBlockHeight(),
                chainId: WSManager.getChainId(),
            };

            // Response format: [opcode (1)] [requestId (4)] [protobuf payload]
            const packedPayload = responsePacket.packPayload(response);
            const fullResponse = new Uint8Array(1 + 4 + packedPayload.length);
            fullResponse[0] = responsePacket.getOpcode();
            fullResponse.set(requestId, 1);
            fullResponse.set(packedPayload, 5);
            client.send(fullResponse);

            return true;
        } catch (error) {
            this.error(`Handshake failed: ${error}`);

            client.closeWithError(ProtocolError.MALFORMED_MESSAGE);
            return false;
        }
    }

    /**
     * Handle plugin opcode request
     */
    private async handlePluginOpcode(
        client: WebSocketClient,
        opcode: number,
        payload: Buffer,
    ): Promise<boolean> {
        // Check handshake requirement (all plugin opcodes require handshake)
        if (!client.isHandshakeCompleted()) {
            client.sendError(0, ProtocolError.HANDSHAKE_REQUIRED);
            client.close(1002, 'Handshake required');
            return false;
        }

        // If we have a local plugin registry (same-process), use it directly
        if (this.pluginRegistry) {
            return this.handlePluginOpcodeLocal(client, opcode, payload);
        }

        // Otherwise, use WSManager to forward to PluginThread via cross-thread communication
        return this.handlePluginOpcodeCrossThread(client, opcode, payload);
    }

    /**
     * Handle plugin opcode using local PluginOpcodeRegistry (same-process)
     */
    private async handlePluginOpcodeLocal(
        client: WebSocketClient,
        opcode: number,
        payload: Buffer,
    ): Promise<boolean> {
        if (!this.pluginRegistry) {
            client.closeWithError(InternalError.INTERNAL_ERROR);
            return false;
        }

        // Get handler
        const handler = this.pluginRegistry.getHandler(opcode);
        if (!handler) {
            this.warn(`No handler registered for plugin opcode 0x${opcode.toString(16)}`);
            client.closeWithError(ProtocolError.UNKNOWN_OPCODE);
            return false;
        }

        // Client sends [requestId (4 bytes LE)] [protobuf payload]
        if (payload.length < 4) {
            client.sendError(0, ProtocolError.MALFORMED_MESSAGE);
            return false;
        }

        // Extract requestId from first 4 bytes (little-endian)
        const requestId = payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24);
        const protobufPayload = payload.subarray(4);

        // Decode request
        let request: unknown;
        try {
            request = this.pluginRegistry.decodeRequest(handler, protobufPayload);
        } catch (error) {
            this.warn(
                `Failed to decode plugin request for opcode 0x${opcode.toString(16)}: ${error}`,
            );
            client.sendError(requestId, ProtocolError.MALFORMED_MESSAGE, 'Failed to deserialize request');
            return false;
        }

        // Check rate limit
        if (!client.startRequest()) {
            client.sendError(requestId, ProtocolError.TOO_MANY_PENDING_REQUESTS);
            return false;
        }

        try {
            // Execute plugin handler
            const result = await this.pluginRegistry.executeHandler(
                handler,
                request,
                requestId.toString(),
                client.clientId,
            );

            if (!result.success) {
                client.sendError(requestId, InternalError.INTERNAL_ERROR, result.error);
                return false;
            }

            // Encode and send response with requestId
            const responsePayload = this.pluginRegistry.encodeResponse(handler, result.result);
            client.sendResponse(handler.responseOpcode, requestId, responsePayload);

            return true;
        } catch (error) {
            this.handleError(client, requestId, error);
            return false;
        } finally {
            client.endRequest();
        }
    }

    /**
     * Handle plugin opcode via cross-thread communication to PluginThread
     */
    private async handlePluginOpcodeCrossThread(
        client: WebSocketClient,
        opcode: number,
        payload: Buffer,
    ): Promise<boolean> {
        // Check if WSManager has this opcode registered
        if (!WSManager.isPluginOpcode(opcode)) {
            this.warn(`No handler registered for plugin opcode 0x${opcode.toString(16)}`);
            client.closeWithError(ProtocolError.UNKNOWN_OPCODE);
            return false;
        }

        // Client sends [requestId (4 bytes LE)] [protobuf payload]
        if (payload.length < 4) {
            client.sendError(0, ProtocolError.MALFORMED_MESSAGE);
            return false;
        }

        // Extract requestId from first 4 bytes (little-endian)
        const requestId = payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24);
        const protobufPayload = payload.subarray(4);

        // Check rate limit
        if (!client.startRequest()) {
            client.sendError(requestId, ProtocolError.TOO_MANY_PENDING_REQUESTS);
            return false;
        }

        try {
            // Forward to PluginThread via WSManager
            const result = await WSManager.executePluginHandler(
                opcode,
                protobufPayload,
                requestId,
                client.clientId,
            );

            if (!result.success) {
                client.sendError(requestId, InternalError.INTERNAL_ERROR, result.error);
                return false;
            }

            // Send response with the opcode, requestId, and payload from PluginThread
            if (result.responseOpcode !== undefined && result.response) {
                client.sendResponse(result.responseOpcode, requestId, result.response);
            }

            return true;
        } catch (error) {
            this.handleError(client, requestId, error);
            return false;
        } finally {
            client.endRequest();
        }
    }

    /**
     * Handle errors from request handlers
     */
    private handleError(client: WebSocketClient, requestId: number, error: unknown): void {
        let errorCode: WebSocketErrorCode = InternalError.INTERNAL_ERROR;
        let message: string;

        if (error instanceof WebSocketAPIError) {
            errorCode = error.code;
            message = error.message;
        } else if (error instanceof Error) {
            message = error.message;
            this.error(`Handler error: ${error.stack}`);
        } else {
            message = 'Unknown error';
            this.error(`Handler error: ${error}`);
        }

        client.sendError(requestId, errorCode, message);

        // Check if error is fatal
        if (client.shouldTerminate(errorCode)) {
            client.close(1008, message);
        }
    }
}

/**
 * Custom error class for WebSocket API errors
 */
export class WebSocketAPIError extends Error {
    public readonly code: WebSocketErrorCode;

    public constructor(code: WebSocketErrorCode, message?: string) {
        super(message);
        this.code = code;
        this.name = 'WebSocketAPIError';
    }
}

/**
 * Singleton instance of the protocol handler
 */
export const Protocol: ProtocolHandler = new ProtocolHandler();
