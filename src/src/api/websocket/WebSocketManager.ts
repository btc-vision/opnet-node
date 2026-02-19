import { Logger } from '@btc-vision/bsi-common';
import { Websocket } from '@btc-vision/hyper-express/types/components/ws/Websocket.js';
import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { SubscriptionType, WebSocketClient, WebSocketClientConfig } from './WebSocketClient.js';
import { Protocol, PROTOCOL_VERSION } from './ProtocolHandler.js';
import { APIRegistry } from './OpcodeRegistry.js';
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { BlockHeaderAPIBlockDocument } from '../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IEpochDocument } from '../../db/documents/interfaces/IEpochDocument.js';
import { APIPacketType } from './packets/types/APIPacketTypes.js';
import { WebSocketConfig } from '../../config/interfaces/IBtcIndexerConfig.js';
import { P2PVersion } from '../../poc/configurations/P2PVersion.js';
import type { PluginOpcodeRegistry } from '../../plugins/api/websocket/PluginOpcodeRegistry.js';
import type { IPluginOpcodeInfo } from '../../plugins/interfaces/IPluginMessages.js';

/**
 * Manager metrics
 */
export interface WebSocketMetrics {
    totalConnections: number;
    activeConnections: number;
    totalMessages: number;
    totalErrors: number;
    uptime: number;
}

/**
 * Manages WebSocket connections and message routing.
 */
export class WebSocketManager extends Logger {
    public readonly logColor: string = '#00ced1';

    /** Active client connections */
    private readonly clients: Map<string, WebSocketClient> = new Map();

    /** Socket to client mapping */
    private readonly socketToClient: WeakMap<Websocket, WebSocketClient> = new WeakMap();

    /** Storage reference */
    private storage: VMStorage | undefined;

    /** Configuration from config file */
    private config: WebSocketConfig | undefined;

    /** Metrics */
    private totalConnections: number = 0;
    private totalMessages: number = 0;
    private totalErrors: number = 0;
    private startTime: number = Date.now();

    /** Current block height (for handshake responses) */
    private currentBlockHeight: bigint = 0n;

    /** Chain ID */
    private chainId: string = 'bitcoin';

    /** Server version */
    private serverVersion: string = P2PVersion;

    /** Whether WebSocket is enabled */
    private enabled: boolean = false;

    /** Registered plugin opcodes by plugin ID */
    private readonly pluginOpcodes: Map<string, IPluginOpcodeInfo[]> = new Map();

    /** Opcode to plugin info mapping for quick lookup */
    private readonly opcodeToPlugin: Map<number, IPluginOpcodeInfo> = new Map();

    /** Callback to execute plugin WebSocket handlers via ServerThread */
    private pluginWsExecutor?: (
        pluginId: string,
        handler: string,
        requestOpcode: number,
        request: Uint8Array,
        requestId: number,
        clientId: string,
    ) => Promise<{ success: boolean; response?: Uint8Array; error?: string }>;

    public constructor() {
        super();
    }

    /**
     * Set the plugin WebSocket handler executor callback
     * Called by ServerThread to enable plugin opcode execution
     */
    public setPluginWsExecutor(
        executor: (
            pluginId: string,
            handler: string,
            requestOpcode: number,
            request: Uint8Array,
            requestId: number,
            clientId: string,
        ) => Promise<{ success: boolean; response?: Uint8Array; error?: string }>,
    ): void {
        this.pluginWsExecutor = executor;
    }

    /**
     * Execute a plugin WebSocket handler
     * Used by ProtocolHandler when handling plugin opcodes
     */
    public async executePluginHandler(
        opcode: number,
        payload: Uint8Array,
        requestId: number,
        clientId: string,
    ): Promise<{
        success: boolean;
        responseOpcode?: number;
        response?: Uint8Array;
        error?: string;
    }> {
        const opcodeInfo = this.opcodeToPlugin.get(opcode);
        if (!opcodeInfo) {
            return { success: false, error: 'Unknown plugin opcode' };
        }

        if (!this.pluginWsExecutor) {
            return { success: false, error: 'Plugin system not initialized' };
        }

        try {
            const result = await this.pluginWsExecutor(
                opcodeInfo.pluginId,
                opcodeInfo.handler,
                opcodeInfo.requestOpcode,
                payload,
                requestId,
                clientId,
            );

            if (!result.success) {
                return { success: false, error: result.error };
            }

            return {
                success: true,
                responseOpcode: opcodeInfo.responseOpcode,
                response: result.response,
            };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Initialize the manager with storage and config
     */
    public initialize(storage: VMStorage, chainId: string, config: WebSocketConfig): void {
        this.storage = storage;
        this.chainId = chainId;
        this.config = config;
        this.enabled = config.ENABLED;

        if (!this.enabled) {
            this.log('WebSocket API is disabled');
            return;
        }

        this.log(
            `WebSocket manager initialized (protocol v${PROTOCOL_VERSION}, max connections: ${config.MAX_CONNECTIONS})`,
        );
    }

    /**
     * Register plugin opcode registry with the protocol handler
     * This should be called by the plugin manager when it initializes
     */
    public registerPluginOpcodeRegistry(registry: PluginOpcodeRegistry): void {
        Protocol.setPluginRegistry(registry);
        this.log('Plugin opcode registry registered with WebSocket manager');
    }

    /**
     * Register plugin opcodes from cross-thread communication
     */
    public registerPluginOpcodes(opcodes: IPluginOpcodeInfo[]): void {
        for (const opcode of opcodes) {
            let opcodeList = this.pluginOpcodes.get(opcode.pluginId);
            if (!opcodeList) {
                opcodeList = [];
                this.pluginOpcodes.set(opcode.pluginId, opcodeList);
            }
            opcodeList.push(opcode);
            this.opcodeToPlugin.set(opcode.requestOpcode, opcode);

            this.log(
                `Registered plugin opcode: ${opcode.pluginId}/${opcode.opcodeName} -> 0x${opcode.requestOpcode.toString(16)}`,
            );
        }
    }

    /**
     * Unregister plugin opcodes
     */
    public unregisterPluginOpcodes(pluginId: string): void {
        const opcodes = this.pluginOpcodes.get(pluginId);
        if (!opcodes) {
            return;
        }

        // Remove from opcode lookup
        for (const opcode of opcodes) {
            this.opcodeToPlugin.delete(opcode.requestOpcode);
        }

        this.pluginOpcodes.delete(pluginId);
        this.log(`Unregistered opcodes for plugin ${pluginId}`);
    }

    /**
     * Get plugin opcode info by request opcode
     */
    public getPluginOpcodeInfo(requestOpcode: number): IPluginOpcodeInfo | undefined {
        return this.opcodeToPlugin.get(requestOpcode);
    }

    /**
     * Check if an opcode is a registered plugin opcode
     */
    public isPluginOpcode(opcode: number): boolean {
        return this.opcodeToPlugin.has(opcode);
    }

    /**
     * Check if WebSocket is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Get the configuration for hyper-express WebSocket route
     */
    public getWSConfig(): { maxPayloadLength: number; idleTimeout: number } {
        return {
            maxPayloadLength: this.config?.MAX_PAYLOAD_SIZE ?? 16 * 1024 * 1024,
            idleTimeout: this.config?.IDLE_TIMEOUT ?? 120,
        };
    }

    /**
     * Handle a new WebSocket connection
     * @param socket The WebSocket connection
     * @param request The upgrade request (contains headers for IP extraction)
     */
    public onConnection(socket: Websocket, request?: Request): void {
        if (!this.enabled) {
            socket.close(1000, 'WebSocket API is disabled');
            return;
        }

        const maxConnections = this.config?.MAX_CONNECTIONS ?? 1000;

        // Check connection limit
        if (this.clients.size >= maxConnections) {
            this.warn('Connection limit reached, rejecting new connection');
            socket.close(1013, 'Server is at capacity');
            return;
        }

        // Get remote address from Cloudflare headers or fallback
        const remoteAddress = this.extractClientIP(request);

        // Create client with config-based settings
        const client = new WebSocketClient(socket, remoteAddress, this.getClientConfig());

        // Store mappings
        this.clients.set(client.clientId, client);
        this.socketToClient.set(socket, client);

        // Update metrics
        this.totalConnections++;

        this.log(`New WebSocket connection: ${client.clientId} from ${remoteAddress}`);
    }

    /**
     * Handle incoming message from socket
     */
    public async onMessage(socket: Websocket, message: ArrayBuffer): Promise<void> {
        const client = this.socketToClient.get(socket);
        if (!client) {
            this.warn('Received message from unknown socket');
            socket.close(1011, 'Unknown client');
            return;
        }

        if (!client.isActive()) {
            return;
        }

        this.totalMessages++;

        try {
            const data = new Uint8Array(message);
            await Protocol.processMessage(client, data);
        } catch (error) {
            this.totalErrors++;
            this.error(`Error processing message from ${client.clientId}: ${error}`);
        }
    }

    /**
     * Handle socket drain event
     */
    public onDrain(socket: Websocket): void {
        const client = this.socketToClient.get(socket);
        if (client) {
            client.onDrain();
        }
    }

    /**
     * Handle socket close event
     */
    public onClose(socket: Websocket, code: number, reason: ArrayBuffer): void {
        const client = this.socketToClient.get(socket);
        if (client) {
            const reasonStr = new TextDecoder().decode(reason);
            this.log(`Client ${client.clientId} disconnected: ${code} ${reasonStr}`);

            client.markClosed();
            this.clients.delete(client.clientId);
        }
    }

    /**
     * Get a client by ID
     */
    public getClient(clientId: string): WebSocketClient | undefined {
        return this.clients.get(clientId);
    }

    /**
     * Get the number of active connections
     */
    public getActiveConnections(): number {
        return this.clients.size;
    }

    /**
     * Get metrics
     */
    public getMetrics(): WebSocketMetrics {
        return {
            totalConnections: this.totalConnections,
            activeConnections: this.clients.size,
            totalMessages: this.totalMessages,
            totalErrors: this.totalErrors,
            uptime: Date.now() - this.startTime,
        };
    }

    /**
     * Handle block change notification
     */
    public onBlockChange(blockHeight: bigint, blockHeader: BlockHeaderAPIBlockDocument): void {
        this.currentBlockHeight = blockHeight;

        if (!this.enabled) {
            return;
        }

        // Notify subscribed clients
        const notificationPacket = APIRegistry.getPacketBuilder(APIPacketType.NewBlockNotification);
        if (!notificationPacket) {
            return;
        }

        const notification = {
            subscriptionId: 0, // Will be set per-client
            blockNumber: blockHeight,
            blockHash: blockHeader.hash ?? '',
            timestamp: BigInt(Date.now()),
            txCount: blockHeader.txCount ?? 0,
        };

        for (const client of this.clients.values()) {
            if (!client.isHandshakeCompleted()) {
                continue;
            }

            // Check if client has block subscription
            for (const [subId, sub] of client.getSubscriptions()) {
                if (sub.type === SubscriptionType.BLOCKS) {
                    notification.subscriptionId = subId;
                    try {
                        const packed = notificationPacket.pack(notification);
                        client.send(packed);
                    } catch (error) {
                        this.error(
                            `Failed to send block notification to ${client.clientId}: ${error}`,
                        );
                    }
                }
            }
        }
    }

    /**
     * Handle epoch finalization notification
     */
    public onEpochFinalized(epochNumber: bigint, epochData: IEpochDocument): void {
        if (!this.enabled) {
            return;
        }

        const notificationPacket = APIRegistry.getPacketBuilder(APIPacketType.NewEpochNotification);
        if (!notificationPacket) {
            return;
        }

        const notification = {
            subscriptionId: 0, // Will be set per-client
            epochNumber: epochNumber.toString(),
            epochHash: epochData.epochHash ?? '',
        };

        for (const client of this.clients.values()) {
            if (!client.isHandshakeCompleted()) {
                continue;
            }

            // Check if client has epoch subscription
            for (const [subId, sub] of client.getSubscriptions()) {
                if (sub.type === SubscriptionType.EPOCHS) {
                    notification.subscriptionId = subId;
                    try {
                        const packed = notificationPacket.pack(notification);
                        client.send(packed);
                    } catch (error) {
                        this.error(
                            `Failed to send epoch notification to ${client.clientId}: ${error}`,
                        );
                    }
                }
            }
        }
    }

    /**
     * Broadcasts a new mempool transaction notification to all subscribed WebSocket clients.
     *
     * @param txId - The txid of the transaction that entered the mempool.
     * @param isOPNet - Whether the transaction targets an OPNet contract.
     */
    public onMempoolTransaction(txId: string, isOPNet: boolean): void {
        if (!this.enabled) {
            return;
        }

        const notificationPacket = APIRegistry.getPacketBuilder(
            APIPacketType.NewMempoolTransactionNotification,
        );
        if (!notificationPacket) {
            return;
        }

        const notification = {
            subscriptionId: 0, // Will be set per-client
            txId,
            isOPNet,
            timestamp: BigInt(Date.now()),
        };

        for (const client of this.clients.values()) {
            if (!client.isHandshakeCompleted()) {
                continue;
            }

            // Check if client has mempool subscription
            for (const [subId, sub] of client.getSubscriptions()) {
                if (sub.type === SubscriptionType.MEMPOOL) {
                    notification.subscriptionId = subId;
                    try {
                        const packed = notificationPacket.pack(notification);
                        client.send(packed);
                    } catch (error) {
                        this.error(
                            `Failed to send mempool notification to ${client.clientId}: ${error}`,
                        );
                    }
                }
            }
        }
    }

    /**
     * Broadcast a message to all connected and handshaked clients
     */
    public broadcast(data: Uint8Array): number {
        let sent = 0;
        for (const client of this.clients.values()) {
            if (client.isHandshakeCompleted() && client.send(data)) {
                sent++;
            }
        }
        return sent;
    }

    /**
     * Graceful shutdown
     */
    public shutdown(): void {
        this.log('Shutting down WebSocket manager...');

        // Notify all clients and close connections
        for (const client of this.clients.values()) {
            client.close(1001, 'Server shutting down');
        }

        this.clients.clear();
        this.log('WebSocket manager shutdown complete');
    }

    /**
     * Get current block height (for handshake responses)
     */
    public getCurrentBlockHeight(): bigint {
        return this.currentBlockHeight;
    }

    /**
     * Get chain ID
     */
    public getChainId(): string {
        return this.chainId;
    }

    /**
     * Get server version
     */
    public getServerVersion(): string {
        return this.serverVersion;
    }

    /**
     * Get client configuration from server config
     */
    private getClientConfig(): WebSocketClientConfig {
        return {
            maxPendingRequests: this.config?.MAX_PENDING_REQUESTS ?? 100,
            requestTimeout: this.config?.REQUEST_TIMEOUT ?? 30000,
            maxRequestsPerSecond: this.config?.MAX_REQUESTS_PER_SECOND ?? 50,
            maxSubscriptions: this.config?.MAX_SUBSCRIPTIONS ?? 10,
        };
    }

    /**
     * Extract client IP address from request headers.
     * Supports Cloudflare proxy headers for real IP detection.
     *
     * Priority order:
     * 1. CF-Connecting-IP (Cloudflare)
     * 2. X-Real-IP (nginx/other proxies)
     * 3. X-Forwarded-For (first IP in chain)
     * 4. Socket remote address
     */
    private extractClientIP(request?: Request): string {
        if (!request) {
            return 'unknown';
        }

        try {
            // Cloudflare header (most reliable when using CF)
            const cfIP = request.header('cf-connecting-ip');
            if (cfIP) {
                return cfIP;
            }

            // X-Real-IP header (commonly set by nginx)
            const realIP = request.header('x-real-ip');
            if (realIP) {
                return realIP;
            }

            // X-Forwarded-For header (can be a chain of IPs)
            const forwardedFor = request.header('x-forwarded-for');
            if (forwardedFor) {
                // Take the first IP in the chain (original client)
                const firstIP = forwardedFor.split(',')[0].trim();
                if (firstIP) {
                    return firstIP;
                }
            }

            // Fallback to request IP (may be proxy IP)
            return request.ip ?? 'unknown';
        } catch {
            return 'unknown';
        }
    }
}

/**
 * Singleton instance of the WebSocket manager
 */
export const WSManager: WebSocketManager = new WebSocketManager();
