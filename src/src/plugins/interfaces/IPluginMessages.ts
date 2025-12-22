export interface IPluginRouteInfo {
    readonly pluginId: string;
    readonly path: string;
    readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    readonly handler: string;
}

export interface IPluginRouteExecuteRequest {
    readonly pluginId: string;
    readonly handler: string;
    readonly request: {
        readonly method: string;
        readonly path: string;
        readonly query: Record<string, string>;
        readonly body: unknown;
        readonly headers: Record<string, string>;
    };
}

export interface IPluginRouteResult {
    readonly status?: number;
    readonly body: unknown;
}

export interface IPluginOpcodeInfo {
    readonly pluginId: string;
    readonly opcodeName: string;
    readonly requestOpcode: number;
    readonly responseOpcode: number;
    readonly handler: string;
    readonly requestType: string;
    readonly responseType: string;
    readonly pushType?: string;
}

export interface IPluginWsExecuteRequest {
    readonly pluginId: string;
    readonly handler: string;
    readonly requestOpcode: number;
    readonly request: Uint8Array;
    readonly requestId: number;
    readonly clientId: string;
}

export interface IPluginWsResult {
    readonly success: boolean;
    readonly result?: unknown;
    readonly error?: string;
}

export interface IPluginRoutesData {
    readonly routes: IPluginRouteInfo[];
}

export interface IPluginOpcodesData {
    readonly opcodes: IPluginOpcodeInfo[];
}

export interface IPluginUnregisterData {
    readonly pluginId: string;
}
