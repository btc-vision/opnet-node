import { Logger } from '@btc-vision/bsi-common';
import { BlockDataWithTransactionData } from '@btc-vision/bitcoin-rpc';

import { PluginRegistry } from '../registry/PluginRegistry.js';
import { PluginWorkerPool } from '../workers/PluginWorkerPool.js';
import {
    HookType,
    HookExecutionMode,
    HookPayload,
    IHookResult,
    IHookDispatchOptions,
    HOOK_CONFIGS,
    IPurgeBlocksPayload,
} from '../interfaces/IPluginHooks.js';
import { IEpochData, IMempoolTransaction, IReorgData } from '../interfaces/IPlugin.js';
import { IReindexCheck } from '../interfaces/IPluginInstallState.js';

import { BlockProcessedData } from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';

/**
 * Extended hook result that includes the return value from the plugin
 */
export interface IHookResultWithValue<T = unknown> extends IHookResult {
    result?: T;
}

/**
 * Hook Dispatcher
 */
export class HookDispatcher extends Logger {
    public readonly logColor: string = '#E91E63';

    constructor(
        private readonly registry: PluginRegistry,
        private readonly workerPool: PluginWorkerPool,
    ) {
        super();
    }

    /**
     * Dispatch block pre-process hook with raw Bitcoin block data
     */
    public async dispatchBlockPreProcess(
        block: BlockDataWithTransactionData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.dispatch(HookType.BLOCK_PRE_PROCESS, block, options);
    }

    /**
     * Dispatch block post-process hook with OPNet processed data
     */
    public async dispatchBlockPostProcess(
        block: BlockProcessedData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.dispatch(HookType.BLOCK_POST_PROCESS, block, options);
    }

    /**
     * Dispatch block change hook with OPNet processed data
     */
    public async dispatchBlockChange(
        block: BlockProcessedData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.dispatch(HookType.BLOCK_CHANGE, block, options);
    }

    /**
     * Dispatch epoch change hook
     */
    public async dispatchEpochChange(
        epoch: IEpochData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.dispatch(HookType.EPOCH_CHANGE, epoch, options);
    }

    /**
     * Dispatch epoch finalized hook
     */
    public async dispatchEpochFinalized(
        epoch: IEpochData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.dispatch(HookType.EPOCH_FINALIZED, epoch, options);
    }

    /**
     * Dispatch mempool transaction hook
     */
    public async dispatchMempoolTransaction(
        tx: IMempoolTransaction,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        return this.dispatch(HookType.MEMPOOL_TRANSACTION, tx, options);
    }

    /**
     * Dispatch reorg hook to all plugins (BLOCKING)
     * CRITICAL: This method blocks until ALL plugins have completed their reorg handling
     * Plugins must revert any state they have stored for blocks >= fromBlock
     */
    public async dispatchReorg(
        reorg: IReorgData,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        this.info(`Dispatching reorg to plugins: from ${reorg.fromBlock} to ${reorg.toBlock}`);

        // Force sequential execution for reorg - must wait for all plugins
        const results = await this.dispatch(HookType.REORG, reorg, {
            ...options,
            continueOnError: false, // Stop on first error during reorg
        });

        // Check for failures
        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
            for (const failure of failures) {
                this.error(`Plugin ${failure.pluginName} failed reorg: ${failure.error}`);
            }
        }

        this.info(`Reorg dispatch complete: ${results.length} plugins processed`);
        return results;
    }

    /**
     * Dispatch reindex required hook to a specific plugin (BLOCKING)
     * CRITICAL: This method blocks until the plugin has completed its reindex handling.
     * Returns the plugin's response (true = handled successfully, false = cannot handle).
     *
     * @param pluginId - The plugin to dispatch to
     * @param reindexCheck - Reindex requirements and actions
     * @returns Hook result with the plugin's boolean response
     */
    public async dispatchReindexRequired(
        pluginId: string,
        reindexCheck: IReindexCheck,
    ): Promise<IHookResultWithValue<boolean>> {
        this.info(
            `Dispatching reindex required to plugin ${pluginId}: ` +
                `action=${reindexCheck.action}, fromBlock=${reindexCheck.reindexFromBlock}`,
        );

        try {
            const config = HOOK_CONFIGS[HookType.REINDEX_REQUIRED];
            const response = await this.workerPool.executeHookWithResult(
                pluginId,
                HookType.REINDEX_REQUIRED,
                reindexCheck,
                config.timeoutMs,
            );

            return {
                success: response.success,
                pluginName: pluginId,
                hookType: HookType.REINDEX_REQUIRED,
                durationMs: response.durationMs,
                error: response.error,
                result: response.result as boolean | undefined,
            };
        } catch (error) {
            const err = error as Error;
            this.error(`Plugin ${pluginId} failed reindex required: ${err.message}`);
            return {
                success: false,
                pluginName: pluginId,
                hookType: HookType.REINDEX_REQUIRED,
                durationMs: 0,
                error: err.message,
            };
        }
    }

    /**
     * Dispatch purge blocks hook to a specific plugin (BLOCKING)
     * CRITICAL: This method blocks until the plugin has purged data for the block range.
     *
     * @param pluginId - The plugin to dispatch to
     * @param fromBlock - Start block to purge (inclusive)
     * @param toBlock - End block to purge (inclusive, or undefined for all blocks >= fromBlock)
     * @returns Hook result
     */
    public async dispatchPurgeBlocks(
        pluginId: string,
        fromBlock: bigint,
        toBlock?: bigint,
    ): Promise<IHookResult> {
        this.info(
            `Dispatching purge blocks to plugin ${pluginId}: ` +
                `from=${fromBlock}, to=${toBlock ?? 'end'}`,
        );

        const payload: IPurgeBlocksPayload = { fromBlock, toBlock };

        try {
            const config = HOOK_CONFIGS[HookType.PURGE_BLOCKS];
            const response = await this.workerPool.executeHook(
                pluginId,
                HookType.PURGE_BLOCKS,
                payload,
                config.timeoutMs,
            );

            return {
                success: response.success,
                pluginName: pluginId,
                hookType: HookType.PURGE_BLOCKS,
                durationMs: response.durationMs,
                error: response.error,
            };
        } catch (error) {
            const err = error as Error;
            this.error(`Plugin ${pluginId} failed purge blocks: ${err.message}`);
            return {
                success: false,
                pluginName: pluginId,
                hookType: HookType.PURGE_BLOCKS,
                durationMs: 0,
                error: err.message,
            };
        }
    }

    /**
     * Dispatch a hook to all eligible plugins
     */
    public async dispatch(
        hookType: HookType,
        payload: HookPayload,
        options?: IHookDispatchOptions,
    ): Promise<IHookResult[]> {
        const config = HOOK_CONFIGS[hookType];
        if (!config) {
            this.warn(`No configuration for hook type: ${hookType}`);
            return [];
        }

        // Get plugins with the required permission
        const plugins = config.requiredPermission
            ? this.registry.getWithPermission(config.requiredPermission)
            : this.registry.getEnabled();

        if (plugins.length === 0) {
            return [];
        }

        const timeoutMs = options?.timeoutMs ?? config.timeoutMs;
        const continueOnError = options?.continueOnError ?? true;

        // Execute based on mode
        if (config.executionMode === HookExecutionMode.PARALLEL) {
            return this.dispatchParallel(hookType, payload, plugins.map((p) => p.id), timeoutMs, continueOnError);
        } else {
            return this.dispatchSequential(hookType, payload, plugins.map((p) => p.id), timeoutMs, continueOnError);
        }
    }

    /**
     * Dispatch to multiple plugins in parallel
     */
    private async dispatchParallel(
        hookType: HookType,
        payload: HookPayload,
        pluginIds: string[],
        timeoutMs: number,
        continueOnError: boolean,
    ): Promise<IHookResult[]> {
        const results: IHookResult[] = [];

        const promises = pluginIds.map(async (pluginId) => {
            try {
                const response = await this.workerPool.executeHook(
                    pluginId,
                    hookType,
                    payload,
                    timeoutMs,
                );

                const result: IHookResult = {
                    success: response.success,
                    pluginName: pluginId,
                    hookType,
                    durationMs: response.durationMs,
                    error: response.error,
                };

                return result;
            } catch (error) {
                const err = error as Error;
                return {
                    success: false,
                    pluginName: pluginId,
                    hookType,
                    durationMs: 0,
                    error: err.message,
                } as IHookResult;
            }
        });

        if (continueOnError) {
            const settled = await Promise.allSettled(promises);
            for (const result of settled) {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    const reason = result.reason as Error | undefined;
                    results.push({
                        success: false,
                        pluginName: 'unknown',
                        hookType,
                        durationMs: 0,
                        error: reason?.message ?? 'Unknown error',
                    });
                }
            }
        } else {
            const resolved = await Promise.all(promises);
            results.push(...resolved);

            // Check for failures
            const failures = resolved.filter((r) => !r.success);
            if (failures.length > 0) {
                this.warn(`${failures.length} hook(s) failed for ${hookType}`);
            }
        }

        return results;
    }

    /**
     * Dispatch to multiple plugins sequentially
     */
    private async dispatchSequential(
        hookType: HookType,
        payload: HookPayload,
        pluginIds: string[],
        timeoutMs: number,
        continueOnError: boolean,
    ): Promise<IHookResult[]> {
        const results: IHookResult[] = [];

        for (const pluginId of pluginIds) {
            try {
                const response = await this.workerPool.executeHook(
                    pluginId,
                    hookType,
                    payload,
                    timeoutMs,
                );

                const result: IHookResult = {
                    success: response.success,
                    pluginName: pluginId,
                    hookType,
                    durationMs: response.durationMs,
                    error: response.error,
                };

                results.push(result);

                if (!response.success && !continueOnError) {
                    this.warn(`Hook ${hookType} failed for ${pluginId}, stopping chain`);
                    break;
                }
            } catch (error) {
                const err = error as Error;
                const result: IHookResult = {
                    success: false,
                    pluginName: pluginId,
                    hookType,
                    durationMs: 0,
                    error: err.message,
                };

                results.push(result);

                if (!continueOnError) {
                    this.warn(`Hook ${hookType} error for ${pluginId}, stopping chain`);
                    break;
                }
            }
        }

        return results;
    }

    /**
     * Dispatch to a single specific plugin
     */
    public async dispatchToPlugin(
        pluginId: string,
        hookType: HookType,
        payload: HookPayload,
        timeoutMs?: number,
    ): Promise<IHookResult> {
        const config = HOOK_CONFIGS[hookType];
        const timeout = timeoutMs ?? config?.timeoutMs ?? 5000;

        try {
            const response = await this.workerPool.executeHook(
                pluginId,
                hookType,
                payload,
                timeout,
            );

            return {
                success: response.success,
                pluginName: pluginId,
                hookType,
                durationMs: response.durationMs,
                error: response.error,
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                pluginName: pluginId,
                hookType,
                durationMs: 0,
                error: err.message,
            };
        }
    }
}
