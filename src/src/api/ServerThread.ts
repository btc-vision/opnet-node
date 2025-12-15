import { Globals } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';

import { Server } from './Server.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import {
    IPluginOpcodesData,
    IPluginRouteExecuteRequest,
    IPluginRoutesData,
    IPluginUnregisterData,
    IPluginWsExecuteRequest,
} from '../plugins/interfaces/IPluginMessages.js';
import { WSManager } from './websocket/WebSocketManager.js';

Globals.register();

class ServerThreadBase extends Thread<ThreadTypes.API> {
    public readonly threadType: ThreadTypes.API = ThreadTypes.API;

    public logColor: string = '#7fffd4';

    private readonly server: Server = new Server();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_m: ThreadMessageBase<MessageType>): Promise<void> {
        // Handle direct messages from parent (not linked threads)
        this.warn(`Unhandled direct message type: ${_m.type}`);
        return Promise.resolve();
    }

    protected async init(): Promise<void> {
        this.log(`Starting API on port ${Config.API.PORT}.`);

        DBManagerInstance.setup();
        await DBManagerInstance.connect();

        // Set up plugin route executor before server init
        this.server.setPluginRouteExecutor(this.executePluginRoute.bind(this));

        // Set up WebSocket plugin handler executor
        WSManager.setPluginWsExecutor(this.executePluginWsHandler.bind(this));

        await this.server.init(Config.API.PORT);
    }

    protected onLinkMessage(
        type: ThreadTypes,
        msg: ThreadMessageBase<MessageType>,
    ): ThreadData | undefined {
        if (type === ThreadTypes.PLUGIN) {
            return this.handlePluginMessage(msg);
        }

        this.warn(`Unhandled link message from thread type: ${type}`);
        return undefined;
    }

    /**
     * Execute a plugin route by forwarding to PluginThread
     */
    private async executePluginRoute(
        pluginId: string,
        handler: string,
        request: Record<string, unknown>,
    ): Promise<{ success: boolean; status?: number; body?: unknown; error?: string }> {
        try {
            const message: ThreadMessageBase<MessageType> = {
                type: MessageType.PLUGIN_EXECUTE_ROUTE,
                data: {
                    pluginId,
                    handler,
                    request,
                } as IPluginRouteExecuteRequest,
            };

            const result = await this.sendMessageToThread(ThreadTypes.PLUGIN, message);

            if (!result) {
                return { success: false, error: 'No response from plugin thread' };
            }

            const response = result as {
                success: boolean;
                status?: number;
                body?: unknown;
                error?: string;
            };

            return response;
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to execute plugin route: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Execute a plugin WebSocket handler by forwarding to PluginThread
     */
    private async executePluginWsHandler(
        pluginId: string,
        handler: string,
        requestOpcode: number,
        request: Uint8Array,
        requestId: number,
        clientId: string,
    ): Promise<{ success: boolean; response?: Uint8Array; error?: string }> {
        try {
            const message: ThreadMessageBase<MessageType> = {
                type: MessageType.PLUGIN_EXECUTE_WS_HANDLER,
                data: {
                    pluginId,
                    handler,
                    requestOpcode,
                    request,
                    requestId,
                    clientId,
                } as IPluginWsExecuteRequest,
            };

            const result = await this.sendMessageToThread(ThreadTypes.PLUGIN, message);

            if (!result) {
                return { success: false, error: 'No response from plugin thread' };
            }

            const response = result as {
                success: boolean;
                response?: Uint8Array;
                error?: string;
            };

            return response;
        } catch (error) {
            const err = error as Error;
            this.error(`Failed to execute plugin WebSocket handler: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    private handlePluginMessage(msg: ThreadMessageBase<MessageType>): ThreadData | undefined {
        switch (msg.type) {
            case MessageType.PLUGIN_REGISTER_ROUTES: {
                const data = msg.data as IPluginRoutesData;
                this.server.registerPluginRoutes(data.routes);
                return { success: true };
            }

            case MessageType.PLUGIN_UNREGISTER_ROUTES: {
                const data = msg.data as IPluginUnregisterData;
                this.server.unregisterPluginRoutes(data.pluginId);
                return { success: true };
            }

            case MessageType.PLUGIN_REGISTER_OPCODES: {
                const data = msg.data as IPluginOpcodesData;
                this.server.registerPluginOpcodes(data.opcodes);
                return { success: true };
            }

            case MessageType.PLUGIN_UNREGISTER_OPCODES: {
                const data = msg.data as IPluginUnregisterData;
                this.server.unregisterPluginOpcodes(data.pluginId);
                return { success: true };
            }

            default:
                this.warn(`Unknown plugin message type: ${msg.type}`);
                return undefined;
        }
    }
}

export const ServerThread = new ServerThreadBase();
