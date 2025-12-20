import { Logger } from '@btc-vision/bsi-common';
import { Websocket } from 'hyper-express/types/components/ws/Websocket.js';
import { randomBytes } from 'crypto';
import {
    AuthError,
    getErrorMessage,
    InternalError,
    isFatalError,
    ProtocolError,
    ResourceError,
    WebSocketErrorCode,
} from './types/errors/WebSocketErrorCodes.js';
import { WebSocketResponseOpcode } from './types/opcodes/WebSocketOpcodes.js';
import { APIPacketType } from './packets/types/APIPacketTypes.js';
import { APIRegistry } from './OpcodeRegistry.js';
import { getSubscriptionTypeName, SubscriptionType } from './types/enums/SubscriptionType.js';
import { Subscription } from './types/messages/APIMessages.js';

/**
 * Connection state for a WebSocket client
 */
export enum ConnectionState {
    /** Connection is open but not yet handshaked */
    CONNECTED = 'connected',

    /** Handshake completed, ready for requests */
    READY = 'ready',

    /** Connection is being closed */
    CLOSING = 'closing',

    /** Connection has been closed */
    CLOSED = 'closed',
}

/**
 * Configuration for WebSocket client
 */
export interface WebSocketClientConfig {
    /** Maximum pending requests allowed per client */
    maxPendingRequests: number;

    /** Request timeout in milliseconds */
    requestTimeout: number;

    /** Rate limit: max requests per second */
    maxRequestsPerSecond: number;

    /** Maximum subscriptions per client */
    maxSubscriptions: number;
}

/**
 * Default client configuration
 */
export const DEFAULT_CLIENT_CONFIG: WebSocketClientConfig = {
    maxPendingRequests: 100,
    requestTimeout: 30000,
    maxRequestsPerSecond: 50,
    maxSubscriptions: 10,
};

// Re-export Subscription from APIMessages for backwards compatibility
export { Subscription } from './types/messages/APIMessages.js';
export { SubscriptionType } from './types/enums/SubscriptionType.js';

/**
 * Represents a connected WebSocket client with full state management.
 */
export class WebSocketClient extends Logger {
    public readonly logColor: string = '#20b2aa';

    /** Unique client identifier */
    public readonly clientId: string;

    /** Remote address for logging */
    public readonly remoteAddress: string;

    /** Connection timestamp */
    public readonly connectedAt: number;

    /** Current connection state */
    private state: ConnectionState = ConnectionState.CONNECTED;

    /** Protocol version negotiated during handshake */
    private protocolVersion: number = 0;

    /** Client name from handshake */
    private clientName: string = '';

    /** Client version from handshake */
    private clientVersion: string = '';

    /** Number of pending requests */
    private pendingRequests: number = 0;

    /** Message queue for backpressure handling */
    private readonly messageQueue: Uint8Array[] = [];

    /** Whether socket is draining */
    private isDraining: boolean = false;

    /** Rate limiting: request timestamps */
    private requestTimestamps: number[] = [];

    /** Active subscriptions */
    private readonly subscriptions: Map<number, Subscription> = new Map();

    /** Next subscription ID */
    private nextSubscriptionId: number = 1;

    /** Configuration */
    private readonly config: WebSocketClientConfig;

    public constructor(
        private readonly socket: Websocket,
        remoteAddress: string,
        config: Partial<WebSocketClientConfig> = {},
    ) {
        super();

        this.clientId = this.generateClientId();
        this.remoteAddress = remoteAddress;
        this.connectedAt = Date.now();
        this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
    }

    /**
     * Get the current connection state
     */
    public getState(): ConnectionState {
        return this.state;
    }

    /**
     * Check if the client has completed handshake
     */
    public isHandshakeCompleted(): boolean {
        return this.state === ConnectionState.READY;
    }

    /**
     * Check if the connection is still active
     */
    public isActive(): boolean {
        return this.state === ConnectionState.CONNECTED || this.state === ConnectionState.READY;
    }

    /**
     * Get the negotiated protocol version
     */
    public getProtocolVersion(): number {
        return this.protocolVersion;
    }

    /**
     * Get client info
     */
    public getClientInfo(): { name: string; version: string } {
        return { name: this.clientName, version: this.clientVersion };
    }

    /**
     * Get active subscriptions
     */
    public getSubscriptions(): Map<number, Subscription> {
        return new Map(this.subscriptions);
    }

    /**
     * Complete the handshake with client info
     */
    public completeHandshake(
        protocolVersion: number,
        clientName: string,
        clientVersion: string,
    ): void {
        if (this.state !== ConnectionState.CONNECTED) {
            throw new Error('Invalid state for handshake completion');
        }

        this.protocolVersion = protocolVersion;
        this.clientName = clientName;
        this.clientVersion = clientVersion;
        this.state = ConnectionState.READY;

        this.log(`Client ${this.clientId} handshake completed: ${clientName} v${clientVersion}`);
    }

    /**
     * Increment pending request count
     * @returns true if request is allowed, false if limit exceeded
     */
    public startRequest(): boolean {
        if (!this.isActive()) {
            return false;
        }

        if (this.pendingRequests >= this.config.maxPendingRequests) {
            return false;
        }

        // Rate limiting check
        if (!this.checkRateLimit()) {
            return false;
        }

        this.pendingRequests++;
        return true;
    }

    /**
     * Decrement pending request count
     */
    public endRequest(): void {
        if (this.pendingRequests > 0) {
            this.pendingRequests--;
        }
    }

    /**
     * Add a subscription
     * @returns subscription ID or null if limit reached
     */
    public addSubscription(type: SubscriptionType): number | null {
        if (this.subscriptions.size >= this.config.maxSubscriptions) {
            return null;
        }

        const id = this.nextSubscriptionId++;
        this.subscriptions.set(id, {
            id,
            type,
            createdAt: Date.now(),
        });

        this.log(
            `Client ${this.clientId} subscribed to ${getSubscriptionTypeName(type)} (id: ${id})`,
        );

        return id;
    }

    /**
     * Remove a subscription
     */
    public removeSubscription(id: number): boolean {
        return this.subscriptions.delete(id);
    }

    /**
     * Check if client has a specific subscription type
     */
    public hasSubscription(type: SubscriptionType): boolean {
        for (const sub of this.subscriptions.values()) {
            if (sub.type === type) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get subscription by ID
     */
    public getSubscription(id: number): Subscription | undefined {
        return this.subscriptions.get(id);
    }

    /**
     * Send a binary message to the client
     * Handles backpressure by queuing messages when socket is draining.
     */
    public send(data: Uint8Array): boolean {
        if (!this.isActive()) {
            this.warn(`Attempted to send to closed client ${this.clientId}`);
            return false;
        }

        if (this.isDraining) {
            // Queue the message for later
            this.messageQueue.push(data);
            return true;
        }

        try {
            // Convert Uint8Array to Buffer for hyper-express compatibility
            const buffer = Buffer.from(data);
            const success = this.socket.send(buffer, true);
            if (!success) {
                // Socket is draining (backpressure)
                this.isDraining = true;
                this.messageQueue.push(data);
            }
            return true;
        } catch (error) {
            this.error(`Failed to send to client ${this.clientId}: ${error}`);
            return false;
        }
    }

    /**
     * Send an error response
     */
    public sendError(
        requestId: number,
        errorCode: WebSocketErrorCode,
        customMessage?: string,
    ): boolean {
        const errorPacket = APIRegistry.getPacketBuilder(APIPacketType.ErrorResponse);
        if (!errorPacket) {
            this.error('Failed to get error packet builder');
            return false;
        }

        const errorData = {
            requestId,
            errorCode,
            errorMessage: customMessage ?? getErrorMessage(errorCode),
        };

        try {
            const packed = errorPacket.pack(errorData);
            return this.send(packed);
        } catch (error) {
            this.error(`Failed to send error response: ${error}`);
            return false;
        }
    }

    /**
     * Send a response with a specific opcode and requestId
     * Format: [opcode (1)] [requestId (4 bytes LE)] [payload]
     */
    public sendResponse(opcode: WebSocketResponseOpcode, requestId: number, payload: Uint8Array): boolean {
        const message = new Uint8Array(1 + 4 + payload.length);
        message[0] = opcode;
        // Write requestId as little-endian uint32
        message[1] = requestId & 0xff;
        message[2] = (requestId >> 8) & 0xff;
        message[3] = (requestId >> 16) & 0xff;
        message[4] = (requestId >> 24) & 0xff;
        message.set(payload, 5);
        return this.send(message);
    }

    /**
     * Handle drain event - flush queued messages
     */
    public onDrain(): void {
        this.isDraining = false;

        // Send queued messages
        while (this.messageQueue.length > 0 && !this.isDraining) {
            const data = this.messageQueue.shift();
            if (data) {
                try {
                    const buffer = Buffer.from(data);
                    const success = this.socket.send(buffer, true);
                    if (!success) {
                        // Still draining, put back and stop
                        this.messageQueue.unshift(data);
                        this.isDraining = true;
                        break;
                    }
                } catch (error) {
                    this.error(`Failed to flush message: ${error}`);
                }
            }
        }
    }

    /**
     * Close the connection with an error
     */
    public closeWithError(errorCode: WebSocketErrorCode, requestId: number = 0): void {
        if (this.state === ConnectionState.CLOSED) {
            return;
        }

        // Send error before closing
        this.sendError(requestId, errorCode);

        // Close the connection
        const wsCloseCode = this.getWebSocketCloseCode(errorCode);
        this.close(wsCloseCode, getErrorMessage(errorCode));
    }

    /**
     * Close the connection gracefully
     */
    public close(code: number = 1000, reason: string = 'Normal closure'): void {
        if (this.state === ConnectionState.CLOSED || this.state === ConnectionState.CLOSING) {
            return;
        }

        this.state = ConnectionState.CLOSING;

        // Clear subscriptions
        this.subscriptions.clear();

        try {
            this.socket.close(code, reason);
        } catch {
            // Socket may already be closed
        }

        this.state = ConnectionState.CLOSED;
        this.log(`Client ${this.clientId} connection closed: ${reason}`);
    }

    /**
     * Mark connection as closed (called from external event)
     */
    public markClosed(): void {
        this.state = ConnectionState.CLOSED;
        this.subscriptions.clear();
    }

    /**
     * Check if error should terminate connection
     */
    public shouldTerminate(errorCode: WebSocketErrorCode): boolean {
        return isFatalError(errorCode);
    }

    /**
     * Generate a unique client ID
     */
    private generateClientId(): string {
        return randomBytes(16).toString('hex');
    }

    /**
     * Check rate limit
     */
    private checkRateLimit(): boolean {
        const now = Date.now();
        const windowStart = now - 1000; // 1 second window

        // Remove old timestamps
        this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > windowStart);

        if (this.requestTimestamps.length >= this.config.maxRequestsPerSecond) {
            return false;
        }

        this.requestTimestamps.push(now);
        return true;
    }

    /**
     * Map error code to WebSocket close code
     */
    private getWebSocketCloseCode(errorCode: WebSocketErrorCode): number {
        if (errorCode === ProtocolError.MALFORMED_MESSAGE) {
            return 1002; // Protocol error
        }
        if (errorCode === ProtocolError.UNSUPPORTED_PROTOCOL_VERSION) {
            return 1002; // Protocol error
        }
        if (errorCode >= AuthError.AUTHENTICATION_REQUIRED && errorCode < ResourceError.NOT_FOUND) {
            return 3000; // Unauthorized (custom)
        }
        if (errorCode >= InternalError.INTERNAL_ERROR) {
            return 1011; // Internal error
        }
        return 1008; // Policy violation
    }
}
