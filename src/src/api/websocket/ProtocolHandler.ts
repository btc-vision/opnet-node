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

    public constructor() {
        super();
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
            client.closeWithError(ProtocolError.MALFORMED_MESSAGE);
            return false;
        }

        // Check if opcode is registered
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

        // For all other requests, deserialize and validate request ID
        let request: Record<string, unknown>;
        try {
            request = registration.requestPacket.unpack(payload) as Record<string, unknown>;
        } catch (error) {
            const opcodeName =
                OpcodeNames[opcode as WebSocketRequestOpcode] ?? `0x${opcode.toString(16)}`;
            this.warn(`Failed to deserialize ${opcodeName}: ${error}`);
            client.sendError(0, ProtocolError.MALFORMED_MESSAGE, 'Failed to deserialize request');
            return false;
        }

        // Extract and validate request ID
        const requestId = request.requestId as number | undefined;
        if (requestId === undefined || typeof requestId !== 'number' || requestId < 0) {
            client.sendError(0, ProtocolError.INVALID_REQUEST_ID);
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

            // Serialize and send response
            const responsePayload = registration.responsePacket.packPayload(response);
            client.sendResponse(registration.responseOpcode, responsePayload);

            return true;
        } catch (error) {
            this.handleError(client, requestId, error);
            return false;
        } finally {
            client.endRequest();
        }
    }

    /**
     * Handle ping request (no request ID)
     */
    private handlePing(client: WebSocketClient, payload: Buffer): boolean {
        try {
            const pingPacket = APIRegistry.getPacketBuilder(APIPacketType.PingRequest);
            const pongPacket = APIRegistry.getPacketBuilder(APIPacketType.PongResponse);

            if (!pingPacket || !pongPacket) {
                return false;
            }

            const pingData = pingPacket.unpack(payload) as { timestamp: bigint | number };
            const pongData = {
                timestamp: pingData.timestamp,
                serverTimestamp: BigInt(Date.now()),
            };

            const packed = pongPacket.pack(pongData);
            client.send(packed);
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

            const handshakeData = handshakePacket.unpack(payload) as {
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

            const packed = responsePacket.pack(response);
            client.send(packed);

            return true;
        } catch (error) {
            this.error(`Handshake failed: ${error}`);
            client.closeWithError(ProtocolError.MALFORMED_MESSAGE);
            return false;
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
