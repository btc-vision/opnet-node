import { IPluginPermissions } from './IPluginPermissions.js';

/**
 * Plugin author information
 */
export interface IPluginAuthor {
    readonly name: string;
    readonly email?: string;
    readonly url?: string;
}

/**
 * Plugin repository information
 */
export interface IPluginRepository {
    readonly type: string;
    readonly url: string;
}

/**
 * Plugin signature information
 */
export interface IPluginSignature {
    readonly algorithm: 'MLDSA44' | 'MLDSA65' | 'MLDSA87';
    readonly publicKeyHash: string;
}

/**
 * Resource limits configuration
 */
export interface IPluginResources {
    readonly memory?: {
        readonly maxHeapMB?: number;
        readonly maxOldGenMB?: number;
        readonly maxYoungGenMB?: number;
    };
    readonly cpu?: {
        readonly maxThreads?: number;
        readonly priority?: 'low' | 'normal' | 'high';
    };
    readonly timeout?: {
        readonly initMs?: number;
        readonly hookMs?: number;
        readonly shutdownMs?: number;
    };
}

/**
 * Lifecycle configuration
 */
export interface IPluginLifecycle {
    readonly loadPriority?: number;
    readonly enabledByDefault?: boolean;
    readonly requiresRestart?: boolean;
}

/**
 * Hook method mapping
 */
export interface IPluginHooksConfig {
    readonly onLoad?: string;
    readonly onUnload?: string;
    readonly onEnable?: string;
    readonly onDisable?: string;
}

/**
 * Configuration schema definition
 */
export interface IPluginConfigSchema {
    readonly schema?: Record<
        string,
        {
            readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
            readonly required?: boolean;
            readonly default?: unknown;
        }
    >;
}

/**
 * Complete plugin metadata structure
 */
export interface IPluginMetadata {
    // Required fields
    readonly name: string;
    readonly version: string;
    readonly opnetVersion: string;
    readonly main: string;
    readonly target: 'bytenode';
    readonly type: 'plugin';
    readonly checksum: string;

    // Author info
    readonly author: IPluginAuthor;
    readonly contributors?: readonly IPluginAuthor[];

    // Repository info
    readonly repository?: IPluginRepository;
    readonly homepage?: string;
    readonly bugs?: { readonly url: string };

    // Licensing
    readonly license?: string;
    readonly private?: boolean;

    // Description
    readonly description?: string;
    readonly keywords?: readonly string[];

    // Dependencies (other plugins, NOT npm)
    readonly dependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;

    // Signature
    readonly signature?: IPluginSignature;

    // Plugin type
    readonly pluginType: 'standalone' | 'library';

    // Permissions
    readonly permissions?: IPluginPermissions;

    // Resources
    readonly resources?: IPluginResources;

    // Lifecycle
    readonly lifecycle?: IPluginLifecycle;

    // Hooks
    readonly hooks?: IPluginHooksConfig;

    // Config
    readonly config?: IPluginConfigSchema;
}

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCES: Required<IPluginResources> = {
    memory: {
        maxHeapMB: 256,
        maxOldGenMB: 128,
        maxYoungGenMB: 64,
    },
    cpu: {
        maxThreads: 2,
        priority: 'normal',
    },
    timeout: {
        initMs: 30000,
        hookMs: 5000,
        shutdownMs: 10000,
    },
};

/**
 * Default lifecycle configuration
 */
export const DEFAULT_LIFECYCLE: Required<IPluginLifecycle> = {
    loadPriority: 100,
    enabledByDefault: true,
    requiresRestart: false,
};

/**
 * Plugin name validation regex
 */
export const PLUGIN_NAME_REGEX = /^[a-z][a-z0-9-]*$/;

/**
 * Maximum plugin name length
 */
export const MAX_PLUGIN_NAME_LENGTH = 64;

/**
 * Maximum description length
 */
export const MAX_DESCRIPTION_LENGTH = 500;
