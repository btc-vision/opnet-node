import { BlockDataWithTransactionData } from '@btc-vision/bitcoin-rpc';
import { BlockProcessedData } from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { IEpochData, IMempoolTransaction, IReorgData } from './IPlugin.js';

/**
 * Hook execution mode
 */
export enum HookExecutionMode {
    /** Execute all handlers in parallel */
    PARALLEL = 'parallel',
    /** Execute handlers sequentially in order */
    SEQUENTIAL = 'sequential',
}

/**
 * Hook types available in the plugin system
 */
export enum HookType {
    // Lifecycle
    LOAD = 'onLoad',
    UNLOAD = 'onUnload',
    ENABLE = 'onEnable',
    DISABLE = 'onDisable',

    // Block
    BLOCK_PRE_PROCESS = 'onBlockPreProcess',
    BLOCK_POST_PROCESS = 'onBlockPostProcess',
    BLOCK_CHANGE = 'onBlockChange',

    // Epoch
    EPOCH_CHANGE = 'onEpochChange',
    EPOCH_FINALIZED = 'onEpochFinalized',

    // Mempool
    MEMPOOL_TRANSACTION = 'onMempoolTransaction',

    // Reorg (CRITICAL - BLOCKING)
    REORG = 'onReorg',
}

/**
 * Hook configuration
 */
export interface IHookConfig {
    readonly type: HookType;
    readonly executionMode: HookExecutionMode;
    readonly timeoutMs: number;
    readonly requiredPermission?: string;
}

/**
 * Hook execution result
 */
export interface IHookResult {
    readonly success: boolean;
    readonly pluginName: string;
    readonly hookType: HookType;
    readonly durationMs: number;
    readonly error?: string;
}

/**
 * Hook dispatch options
 */
export interface IHookDispatchOptions {
    readonly timeoutMs?: number;
    readonly continueOnError?: boolean;
}

/**
 * Union type for all hook payloads
 * Uses existing OPNet interfaces directly to minimize serialization overhead
 */
export type HookPayload =
    | BlockDataWithTransactionData    // Raw block for pre-process
    | BlockProcessedData              // Processed block for post-process/change
    | IEpochData                      // Epoch data
    | IMempoolTransaction             // Mempool transaction
    | IReorgData                      // Reorg data
    | undefined;                      // Lifecycle hooks (no payload)

/**
 * Hook configurations for all hook types
 */
export const HOOK_CONFIGS: Record<HookType, IHookConfig> = {
    // Lifecycle hooks - sequential, longer timeout
    [HookType.LOAD]: {
        type: HookType.LOAD,
        executionMode: HookExecutionMode.SEQUENTIAL,
        timeoutMs: 30000,
    },
    [HookType.UNLOAD]: {
        type: HookType.UNLOAD,
        executionMode: HookExecutionMode.SEQUENTIAL,
        timeoutMs: 10000,
    },
    [HookType.ENABLE]: {
        type: HookType.ENABLE,
        executionMode: HookExecutionMode.SEQUENTIAL,
        timeoutMs: 5000,
    },
    [HookType.DISABLE]: {
        type: HookType.DISABLE,
        executionMode: HookExecutionMode.SEQUENTIAL,
        timeoutMs: 5000,
    },

    // Block hooks - parallel execution
    [HookType.BLOCK_PRE_PROCESS]: {
        type: HookType.BLOCK_PRE_PROCESS,
        executionMode: HookExecutionMode.PARALLEL,
        timeoutMs: 5000,
        requiredPermission: 'blocks.preProcess',
    },
    [HookType.BLOCK_POST_PROCESS]: {
        type: HookType.BLOCK_POST_PROCESS,
        executionMode: HookExecutionMode.PARALLEL,
        timeoutMs: 5000,
        requiredPermission: 'blocks.postProcess',
    },
    [HookType.BLOCK_CHANGE]: {
        type: HookType.BLOCK_CHANGE,
        executionMode: HookExecutionMode.PARALLEL,
        timeoutMs: 5000,
        requiredPermission: 'blocks.onChange',
    },

    // Epoch hooks - parallel execution
    [HookType.EPOCH_CHANGE]: {
        type: HookType.EPOCH_CHANGE,
        executionMode: HookExecutionMode.PARALLEL,
        timeoutMs: 5000,
        requiredPermission: 'epochs.onChange',
    },
    [HookType.EPOCH_FINALIZED]: {
        type: HookType.EPOCH_FINALIZED,
        executionMode: HookExecutionMode.PARALLEL,
        timeoutMs: 5000,
        requiredPermission: 'epochs.onFinalized',
    },

    // Mempool hooks - parallel execution
    [HookType.MEMPOOL_TRANSACTION]: {
        type: HookType.MEMPOOL_TRANSACTION,
        executionMode: HookExecutionMode.PARALLEL,
        timeoutMs: 2000,
        requiredPermission: 'mempool.txFeed',
    },

    // Reorg hook - SEQUENTIAL and BLOCKING (all plugins must complete)
    // This is critical for data consistency - plugins must revert their state
    [HookType.REORG]: {
        type: HookType.REORG,
        executionMode: HookExecutionMode.SEQUENTIAL,
        timeoutMs: 300000, // 5 minutes - reorg can take time
    },
};
