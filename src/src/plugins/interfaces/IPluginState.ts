import { IPluginMetadata } from './IPluginMetadata.js';
import { IParsedPluginFile } from './IPluginFile.js';
import { IPluginInstallState } from './IPluginInstallState.js';

/**
 * Plugin lifecycle states
 */
export enum PluginState {
    /** Plugin file discovered but not loaded */
    DISCOVERED = 'discovered',

    /** Plugin passed validation */
    VALIDATED = 'validated',

    /** Plugin is currently loading */
    LOADING = 'loading',

    /** Plugin loaded in worker */
    LOADED = 'loaded',

    /** Plugin is syncing/catching up with chain (BLOCKING) */
    SYNCING = 'syncing',

    /** Plugin active and receiving hooks */
    ENABLED = 'enabled',

    /** Plugin loaded but not receiving hooks */
    DISABLED = 'disabled',

    /** Plugin crashed, requires manual re-enable */
    CRASHED = 'crashed',

    /** Plugin failed validation or loading */
    ERROR = 'error',

    /** Plugin is currently unloading */
    UNLOADING = 'unloading',
}

/**
 * Plugin error information
 */
export interface IPluginError {
    readonly code: string;
    readonly message: string;
    readonly stack?: string;
    readonly timestamp: number;
}

/**
 * Registered plugin information
 */
export interface IRegisteredPlugin {
    /** Unique plugin identifier (name) */
    readonly id: string;

    /** Plugin file path */
    readonly filePath: string;

    /** Parsed plugin file data */
    readonly file: IParsedPluginFile;

    /** Plugin metadata */
    readonly metadata: IPluginMetadata;

    /** Current plugin state */
    state: PluginState;

    /** Worker ID where plugin is loaded (if any) */
    workerId?: number;

    /** Error information (if state is ERROR or CRASHED) */
    error?: IPluginError;

    /** Timestamp when plugin was loaded */
    loadedAt?: number;

    /** Timestamp when plugin was enabled */
    enabledAt?: number;

    /** Block height when plugin was enabled (0 = genesis) */
    enabledAtBlock?: bigint;

    /** Plugins that depend on this one */
    dependents: Set<string>;

    /** Plugins this one depends on */
    dependencies: Set<string>;

    /** Whether this is the first installation of this plugin */
    isFirstInstall?: boolean;

    /** Persisted install state (from database) */
    installState?: IPluginInstallState;

    /** Whether the plugin file is disabled (.opnet.disabled) */
    isFileDisabled?: boolean;
}

/**
 * Plugin state change event
 */
export interface IPluginStateChange {
    readonly pluginId: string;
    readonly previousState: PluginState;
    readonly newState: PluginState;
    readonly timestamp: number;
    readonly error?: IPluginError;
}

/**
 * State transition validation
 */
export const VALID_STATE_TRANSITIONS: Record<PluginState, readonly PluginState[]> = {
    [PluginState.DISCOVERED]: [PluginState.VALIDATED, PluginState.ERROR],
    [PluginState.VALIDATED]: [PluginState.LOADING, PluginState.ERROR],
    [PluginState.LOADING]: [PluginState.LOADED, PluginState.ERROR],
    [PluginState.LOADED]: [
        PluginState.SYNCING,
        PluginState.ENABLED,
        PluginState.DISABLED,
        PluginState.UNLOADING,
    ],
    [PluginState.SYNCING]: [PluginState.ENABLED, PluginState.ERROR, PluginState.CRASHED],
    [PluginState.ENABLED]: [PluginState.DISABLED, PluginState.CRASHED, PluginState.UNLOADING],
    [PluginState.DISABLED]: [PluginState.ENABLED, PluginState.SYNCING, PluginState.UNLOADING],
    [PluginState.CRASHED]: [PluginState.ENABLED, PluginState.SYNCING, PluginState.UNLOADING],
    [PluginState.ERROR]: [PluginState.DISCOVERED], // Can retry after fixing
    [PluginState.UNLOADING]: [PluginState.DISCOVERED], // Can reload
};

/**
 * Check if a state transition is valid
 */
export function isValidStateTransition(from: PluginState, to: PluginState): boolean {
    return VALID_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Plugin statistics
 */
export interface IPluginStats {
    readonly pluginId: string;
    readonly hooksExecuted: number;
    readonly hooksFailed: number;
    readonly totalExecutionTimeMs: number;
    readonly averageExecutionTimeMs: number;
    readonly lastExecutionTimestamp?: number;
    readonly memoryUsageBytes?: number;
}
