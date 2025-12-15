import { PluginContext } from '../context/PluginContext.js';
import { BlockDataWithTransactionData } from '@btc-vision/bitcoin-rpc';
import { BlockProcessedData } from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';

/**
 * Epoch data passed to plugin hooks
 */
export interface IEpochData {
    readonly epochNumber: bigint;
    readonly startBlock: bigint;
    readonly endBlock: bigint;
    readonly checksumRoot?: string;
}

/**
 * Mempool transaction data
 */
export interface IMempoolTransaction {
    readonly txid: string;
    readonly hash: string;
    readonly size: number;
    readonly fee: bigint;
    readonly timestamp: number;
}

/**
 * Reorg data passed to plugin hooks
 * IMPORTANT: Plugins MUST handle reorgs to maintain data consistency
 */
export interface IReorgData {
    readonly fromBlock: bigint;
    readonly toBlock: bigint;
    readonly reason: string;
}

/**
 * Plugin router for HTTP API extensions
 */
export interface IPluginRouter {
    get(path: string, handler: string): void;
    post(path: string, handler: string): void;
    put(path: string, handler: string): void;
    delete(path: string, handler: string): void;
    patch(path: string, handler: string): void;
}

/**
 * Plugin WebSocket interface for WS API extensions
 */
export interface IPluginWebSocket {
    registerHandler(opcode: string, handler: string): void;
    createSubscription(clientId: string): number;
    pushNotification(clientId: string, subscriptionId: number, data: unknown): void;
    closeSubscription(subscriptionId: number): void;
}

/**
 * Main plugin interface that all plugins must implement
 */
export interface IPlugin {
    /**
     * Called when the plugin is loaded
     * Use this to initialize resources, connect to databases, etc.
     */
    onLoad?(context: PluginContext): Promise<void>;

    /**
     * Called when the plugin is being unloaded
     * Use this to clean up resources, close connections, etc.
     */
    onUnload?(): Promise<void>;

    /**
     * Called when the plugin is enabled
     * Plugin may be loaded but disabled, this is called when it becomes active
     */
    onEnable?(): Promise<void>;

    /**
     * Called when the plugin is disabled
     * Plugin remains loaded but stops receiving hooks
     */
    onDisable?(): Promise<void>;

    /**
     * Called before a block is processed with raw Bitcoin block data
     * Receives full block data including all transactions from Bitcoin RPC
     * Requires blocks.preProcess permission
     */
    onBlockPreProcess?(block: BlockDataWithTransactionData): Promise<void>;

    /**
     * Called after a block is processed with OPNet processed data
     * Receives block data with checksums, merkle roots, and OPNet state
     * Requires blocks.postProcess permission
     */
    onBlockPostProcess?(block: BlockProcessedData): Promise<void>;

    /**
     * Called when a new block is confirmed with OPNet processed data
     * Requires blocks.onChange permission
     */
    onBlockChange?(block: BlockProcessedData): Promise<void>;

    /**
     * Called when the epoch number changes
     * Requires epochs.onChange permission
     */
    onEpochChange?(epoch: IEpochData): Promise<void>;

    /**
     * Called when an epoch is finalized (merkle tree complete)
     * Requires epochs.onFinalized permission
     */
    onEpochFinalized?(epoch: IEpochData): Promise<void>;

    /**
     * Called when a new transaction enters the mempool
     * Requires mempool.txFeed permission
     */
    onMempoolTransaction?(tx: IMempoolTransaction): Promise<void>;

    /**
     * Called when the blockchain reorgs (CRITICAL - BLOCKING)
     * Plugins MUST revert any state they have stored for blocks >= fromBlock
     * This hook is called synchronously and blocks the indexer until all plugins complete
     * Failure to properly handle reorgs will result in data inconsistency
     */
    onReorg?(reorg: IReorgData): Promise<void>;

    /**
     * Called to register HTTP routes
     * Requires api.addEndpoints permission
     */
    registerRoutes?(router: IPluginRouter): void;

    /**
     * Called to register WebSocket handlers
     * Requires api.addWebsocket permission
     */
    registerWebSocketHandlers?(ws: IPluginWebSocket): void;
}

/**
 * Plugin constructor type
 */
export type PluginConstructor = new () => IPlugin;

/**
 * Plugin module export structure
 */
export interface IPluginModule {
    default: PluginConstructor;
}
