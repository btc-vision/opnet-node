import { HookType, HookPayload } from '../interfaces/IPluginHooks.js';

/**
 * Message types from main thread to worker
 */
export enum WorkerMessageType {
    // Plugin lifecycle
    LOAD_PLUGIN = 'load_plugin',
    UNLOAD_PLUGIN = 'unload_plugin',
    ENABLE_PLUGIN = 'enable_plugin',
    DISABLE_PLUGIN = 'disable_plugin',

    // Hook execution
    EXECUTE_HOOK = 'execute_hook',

    // API route handling
    EXECUTE_ROUTE_HANDLER = 'execute_route_handler',

    // WebSocket handling
    EXECUTE_WS_HANDLER = 'execute_ws_handler',

    // Worker control
    SHUTDOWN = 'shutdown',
    PING = 'ping',
}

/**
 * Message types from worker to main thread
 */
export enum WorkerResponseType {
    // Lifecycle responses
    PLUGIN_LOADED = 'plugin_loaded',
    PLUGIN_UNLOADED = 'plugin_unloaded',
    PLUGIN_ENABLED = 'plugin_enabled',
    PLUGIN_DISABLED = 'plugin_disabled',

    // Hook responses
    HOOK_RESULT = 'hook_result',

    // API responses
    ROUTE_RESULT = 'route_result',
    WS_RESULT = 'ws_result',

    // Error reporting
    PLUGIN_ERROR = 'plugin_error',
    PLUGIN_CRASHED = 'plugin_crashed',

    // Worker control
    READY = 'ready',
    PONG = 'pong',
    SHUTDOWN_COMPLETE = 'shutdown_complete',
}

/**
 * Base message structure
 */
export interface IWorkerMessage {
    readonly type: WorkerMessageType;
    readonly requestId: string;
    readonly pluginId?: string;
}

/**
 * Base response structure
 */
export interface IWorkerResponse {
    readonly type: WorkerResponseType;
    readonly requestId: string;
    readonly pluginId?: string;
    readonly success: boolean;
    readonly error?: string;
}

/**
 * Load plugin message
 */
export interface ILoadPluginMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.LOAD_PLUGIN;
    readonly pluginId: string;
    readonly bytecode: Buffer;
    readonly metadata: string; // JSON serialized
    readonly dataDir: string;
    readonly config: string; // JSON serialized
    readonly emitErrorOrWarning: boolean;
}

/**
 * Unload plugin message
 */
export interface IUnloadPluginMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.UNLOAD_PLUGIN;
    readonly pluginId: string;
}

/**
 * Enable plugin message
 */
export interface IEnablePluginMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.ENABLE_PLUGIN;
    readonly pluginId: string;
}

/**
 * Disable plugin message
 */
export interface IDisablePluginMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.DISABLE_PLUGIN;
    readonly pluginId: string;
}

/**
 * Execute hook message
 */
export interface IExecuteHookMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.EXECUTE_HOOK;
    readonly pluginId: string;
    readonly hookType: HookType;
    readonly payload: string; // JSON serialized HookPayload
    readonly timeoutMs: number;
}

/**
 * Execute route handler message
 */
export interface IExecuteRouteHandlerMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.EXECUTE_ROUTE_HANDLER;
    readonly pluginId: string;
    readonly handler: string;
    readonly request: string; // JSON serialized request
}

/**
 * Execute WebSocket handler message
 */
export interface IExecuteWsHandlerMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.EXECUTE_WS_HANDLER;
    readonly pluginId: string;
    readonly handler: string;
    readonly request: string; // JSON serialized request
    readonly wsRequestId: string; // WebSocket client's request ID
    readonly clientId: string;
}

/**
 * Shutdown message
 */
export interface IShutdownMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.SHUTDOWN;
}

/**
 * Ping message
 */
export interface IPingMessage extends IWorkerMessage {
    readonly type: WorkerMessageType.PING;
}

/**
 * Plugin loaded response
 */
export interface IPluginLoadedResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.PLUGIN_LOADED;
    readonly pluginId: string;
}

/**
 * Hook result response
 */
export interface IHookResultResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.HOOK_RESULT;
    readonly pluginId: string;
    readonly hookType: HookType;
    readonly durationMs: number;
}

/**
 * Route result response
 */
export interface IRouteResultResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.ROUTE_RESULT;
    readonly pluginId: string;
    readonly handler: string;
    readonly result: string; // JSON serialized result
    readonly status: number;
}

/**
 * WebSocket result response
 */
export interface IWsResultResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.WS_RESULT;
    readonly pluginId: string;
    readonly handler: string;
    readonly result: string; // JSON serialized result
}

/**
 * Plugin error response
 */
export interface IPluginErrorResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.PLUGIN_ERROR;
    readonly pluginId: string;
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly errorStack?: string;
}

/**
 * Plugin crashed response
 */
export interface IPluginCrashedResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.PLUGIN_CRASHED;
    readonly pluginId: string;
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly errorStack?: string;
}

/**
 * Worker ready response
 */
export interface IWorkerReadyResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.READY;
    readonly workerId: number;
}

/**
 * Pong response
 */
export interface IPongResponse extends IWorkerResponse {
    readonly type: WorkerResponseType.PONG;
}

/**
 * Union type for all worker messages
 */
export type WorkerMessage =
    | ILoadPluginMessage
    | IUnloadPluginMessage
    | IEnablePluginMessage
    | IDisablePluginMessage
    | IExecuteHookMessage
    | IExecuteRouteHandlerMessage
    | IExecuteWsHandlerMessage
    | IShutdownMessage
    | IPingMessage;

/**
 * Union type for all worker responses
 */
export type WorkerResponse =
    | IPluginLoadedResponse
    | IHookResultResponse
    | IRouteResultResponse
    | IWsResultResponse
    | IPluginErrorResponse
    | IPluginCrashedResponse
    | IWorkerReadyResponse
    | IPongResponse
    | IWorkerResponse;

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
