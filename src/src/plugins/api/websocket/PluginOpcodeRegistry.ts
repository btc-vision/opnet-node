import { Logger } from '@btc-vision/bsi-common';
import * as protobuf from 'protobufjs';

import { PluginWorkerPool } from '../../workers/PluginWorkerPool.js';
import { PluginRegistry } from '../../registry/PluginRegistry.js';
import { IPluginWebSocketHandler, IWebSocketPermissions } from '../../interfaces/IPluginPermissions.js';
import { IRegisteredPlugin, PluginState } from '../../interfaces/IPluginState.js';

/**
 * Plugin opcode ranges
 */
export const PLUGIN_REQUEST_OPCODE_BASE = 0xa0;
export const PLUGIN_RESPONSE_OPCODE_BASE = 0xc0;
export const OPCODES_PER_PLUGIN = 8;

/**
 * Opcode allocation for a plugin
 */
export interface IOpcodeAllocation {
    readonly pluginId: string;
    readonly requestBase: number;
    readonly responseBase: number;
    readonly count: number;
}

/**
 * Registered plugin handler
 */
export interface IRegisteredHandler {
    readonly pluginId: string;
    readonly opcodeName: string;
    readonly requestOpcode: number;
    readonly responseOpcode: number;
    readonly handler: string;
    readonly requestType: protobuf.Type;
    readonly responseType: protobuf.Type;
    readonly pushType?: protobuf.Type;
}

/**
 * Plugin Opcode Registry
 */
export class PluginOpcodeRegistry extends Logger {
    public readonly logColor: string = '#FF5722';

    /** Opcode allocations by plugin ID */
    private readonly allocations: Map<string, IOpcodeAllocation> = new Map();

    /** Registered handlers by request opcode */
    private readonly handlers: Map<number, IRegisteredHandler> = new Map();

    /** Protobuf roots by plugin ID */
    private readonly protoRoots: Map<string, protobuf.Root> = new Map();

    /** Next available request opcode */
    private nextRequestOpcode = PLUGIN_REQUEST_OPCODE_BASE;

    /** Next available response opcode */
    private nextResponseOpcode = PLUGIN_RESPONSE_OPCODE_BASE;

    constructor(
        private readonly registry: PluginRegistry,
        private readonly workerPool: PluginWorkerPool,
    ) {
        super();
    }

    /**
     * Register WebSocket handlers for a plugin
     */
    public registerPlugin(plugin: IRegisteredPlugin): IRegisteredHandler[] {
        const permissions = plugin.metadata.permissions?.api;
        if (!permissions?.addWebsocket || !permissions.websocket) {
            return [];
        }

        const wsConfig = permissions.websocket;
        if (!wsConfig.handlers || wsConfig.handlers.length === 0) {
            return [];
        }

        // Load proto schema if provided
        if (wsConfig.protoFile && plugin.file.proto) {
            this.loadProtoSchema(plugin.id, plugin.file.proto, wsConfig.namespace);
        }

        // Allocate opcodes
        const allocation = this.allocateOpcodes(plugin.id, wsConfig.handlers.length);

        // Register handlers
        const registeredHandlers: IRegisteredHandler[] = [];

        for (let i = 0; i < wsConfig.handlers.length; i++) {
            const handlerDef = wsConfig.handlers[i];
            const requestOpcode = allocation.requestBase + i;
            const responseOpcode = allocation.responseBase + i;

            try {
                const handler = this.registerHandler(
                    plugin.id,
                    handlerDef,
                    requestOpcode,
                    responseOpcode,
                    wsConfig.namespace,
                );
                registeredHandlers.push(handler);
            } catch (error) {
                this.error(`Failed to register handler ${handlerDef.opcode} for ${plugin.id}: ${error}`);
            }
        }

        this.info(
            `Registered ${registeredHandlers.length} WebSocket handler(s) for plugin ${plugin.id}`,
        );

        return registeredHandlers;
    }

    /**
     * Unregister handlers for a plugin
     */
    public unregisterPlugin(pluginId: string): void {
        const allocation = this.allocations.get(pluginId);
        if (!allocation) {
            return;
        }

        // Remove handlers
        for (let i = 0; i < allocation.count; i++) {
            this.handlers.delete(allocation.requestBase + i);
        }

        // Remove proto root
        this.protoRoots.delete(pluginId);

        // Remove allocation (but don't reclaim opcodes to avoid conflicts)
        this.allocations.delete(pluginId);

        this.info(`Unregistered WebSocket handlers for plugin ${pluginId}`);
    }

    /**
     * Get handler by request opcode
     */
    public getHandler(requestOpcode: number): IRegisteredHandler | undefined {
        return this.handlers.get(requestOpcode);
    }

    /**
     * Check if an opcode is a plugin opcode
     */
    public isPluginOpcode(opcode: number): boolean {
        return opcode >= PLUGIN_REQUEST_OPCODE_BASE && opcode < 0xe0;
    }

    /**
     * Get all registered handlers
     */
    public getAllHandlers(): IRegisteredHandler[] {
        return Array.from(this.handlers.values());
    }

    /**
     * Get handlers for a plugin
     */
    public getPluginHandlers(pluginId: string): IRegisteredHandler[] {
        return this.getAllHandlers().filter((h) => h.pluginId === pluginId);
    }

    /**
     * Execute a plugin WebSocket handler
     */
    public async executeHandler(
        handler: IRegisteredHandler,
        request: unknown,
        requestId: string,
        clientId: string,
    ): Promise<{ success: boolean; result?: unknown; error?: string }> {
        // Check plugin is enabled
        const plugin = this.registry.get(handler.pluginId);
        if (!plugin || plugin.state !== PluginState.ENABLED) {
            return {
                success: false,
                error: 'Plugin not available',
            };
        }

        try {
            const result = await this.workerPool.executeWsHandler(
                handler.pluginId,
                handler.handler,
                request,
                requestId,
                clientId,
            );

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || 'Handler failed',
                };
            }

            return {
                success: true,
                result: JSON.parse(result.result),
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: err.message,
            };
        }
    }

    /**
     * Allocate opcodes for a plugin
     */
    private allocateOpcodes(pluginId: string, handlerCount: number): IOpcodeAllocation {
        // Check if already allocated
        const existing = this.allocations.get(pluginId);
        if (existing) {
            return existing;
        }

        const count = Math.min(handlerCount, OPCODES_PER_PLUGIN);

        const allocation: IOpcodeAllocation = {
            pluginId,
            requestBase: this.nextRequestOpcode,
            responseBase: this.nextResponseOpcode,
            count,
        };

        this.nextRequestOpcode += OPCODES_PER_PLUGIN;
        this.nextResponseOpcode += OPCODES_PER_PLUGIN;

        this.allocations.set(pluginId, allocation);

        this.info(
            `Allocated opcodes for ${pluginId}: request 0x${allocation.requestBase.toString(16)}-0x${(allocation.requestBase + count - 1).toString(16)}`,
        );

        return allocation;
    }

    /**
     * Load a plugin's proto schema
     */
    private loadProtoSchema(
        pluginId: string,
        protoContent: Buffer,
        _namespace?: string,
    ): void {
        try {
            const protoString = protoContent.toString('utf8');
            const root = protobuf.parse(protoString).root;
            this.protoRoots.set(pluginId, root);
            this.info(`Loaded proto schema for plugin ${pluginId}`);
        } catch (error) {
            throw new Error(`Failed to parse proto schema: ${error}`);
        }
    }

    /**
     * Register a single handler
     */
    private registerHandler(
        pluginId: string,
        handlerDef: IPluginWebSocketHandler,
        requestOpcode: number,
        responseOpcode: number,
        namespace?: string,
    ): IRegisteredHandler {
        const root = this.protoRoots.get(pluginId);
        if (!root) {
            throw new Error(`No proto schema loaded for plugin ${pluginId}`);
        }

        const ns = namespace ? `${namespace}.` : '';

        // Look up message types
        const requestType = root.lookupType(`${ns}${handlerDef.requestType}`);
        const responseType = root.lookupType(`${ns}${handlerDef.responseType}`);
        let pushType: protobuf.Type | undefined;

        if (handlerDef.pushType) {
            pushType = root.lookupType(`${ns}${handlerDef.pushType}`);
        }

        const handler: IRegisteredHandler = {
            pluginId,
            opcodeName: handlerDef.opcode,
            requestOpcode,
            responseOpcode,
            handler: handlerDef.handler,
            requestType,
            responseType,
            pushType,
        };

        this.handlers.set(requestOpcode, handler);

        this.info(
            `Registered WS handler: ${pluginId}/${handlerDef.opcode} -> 0x${requestOpcode.toString(16)}`,
        );

        return handler;
    }

    /**
     * Get proto type for a plugin
     */
    public getProtoType(pluginId: string, typeName: string): protobuf.Type | undefined {
        const root = this.protoRoots.get(pluginId);
        if (!root) {
            return undefined;
        }

        try {
            return root.lookupType(typeName);
        } catch {
            return undefined;
        }
    }

    /**
     * Decode a request message
     */
    public decodeRequest(handler: IRegisteredHandler, data: Uint8Array): unknown {
        return handler.requestType.decode(data);
    }

    /**
     * Encode a response message
     */
    public encodeResponse(handler: IRegisteredHandler, data: unknown): Uint8Array {
        const message = handler.responseType.create(data as object);
        return handler.responseType.encode(message).finish();
    }
}
