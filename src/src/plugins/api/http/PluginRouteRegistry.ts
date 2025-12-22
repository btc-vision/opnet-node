import { Logger } from '@btc-vision/bsi-common';
import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';

import { PluginWorkerPool } from '../../workers/PluginWorkerPool.js';
import { PluginRegistry } from '../../registry/PluginRegistry.js';
import { IRegisteredPlugin, PluginState } from '../../interfaces/IPluginState.js';

/**
 * Route instance for a plugin
 */
export interface IPluginRouteInstance {
    readonly pluginId: string;
    readonly path: string;
    readonly method: string;
    readonly handler: string;
    readonly fullPath: string;
    readonly rateLimit?: number;
}

/**
 * Plugin Route Registry
 */
export class PluginRouteRegistry extends Logger {
    public readonly logColor: string = '#00BCD4';

    /** Registered routes by plugin ID */
    private readonly routes: Map<string, IPluginRouteInstance[]> = new Map();

    /** Route handlers by full path */
    private readonly handlers: Map<string, IPluginRouteInstance> = new Map();

    constructor(
        private readonly registry: PluginRegistry,
        private readonly workerPool: PluginWorkerPool,
        private readonly apiPrefix: string = '/api/v1',
    ) {
        super();
    }

    /**
     * Register routes for a plugin
     */
    public registerPlugin(plugin: IRegisteredPlugin): IPluginRouteInstance[] {
        const permissions = plugin.metadata.permissions?.api;
        if (!permissions?.addEndpoints || !permissions.routes) {
            return [];
        }

        const basePath = permissions.basePath || `/plugins/${plugin.id}`;
        const instances: IPluginRouteInstance[] = [];

        for (const routeDef of permissions.routes) {
            const fullPath = `${this.apiPrefix}${basePath}/${routeDef.path}`.replace(/\/+/g, '/');

            const instance: IPluginRouteInstance = {
                pluginId: plugin.id,
                path: routeDef.path,
                method: routeDef.method,
                handler: routeDef.handler,
                fullPath,
                rateLimit: routeDef.rateLimit,
            };

            instances.push(instance);
            this.handlers.set(`${routeDef.method}:${fullPath}`, instance);
        }

        this.routes.set(plugin.id, instances);
        this.info(`Registered ${instances.length} route(s) for plugin ${plugin.id}`);

        return instances;
    }

    /**
     * Unregister routes for a plugin
     */
    public unregisterPlugin(pluginId: string): void {
        const instances = this.routes.get(pluginId);
        if (!instances) {
            return;
        }

        for (const instance of instances) {
            this.handlers.delete(`${instance.method}:${instance.fullPath}`);
        }

        this.routes.delete(pluginId);
        this.info(`Unregistered routes for plugin ${pluginId}`);
    }

    /**
     * Get all routes for a plugin
     */
    public getPluginRoutes(pluginId: string): IPluginRouteInstance[] {
        return this.routes.get(pluginId) ?? [];
    }

    /**
     * Get all registered routes
     */
    public getAllRoutes(): IPluginRouteInstance[] {
        const all: IPluginRouteInstance[] = [];
        for (const routes of this.routes.values()) {
            all.push(...routes);
        }
        return all;
    }

    /**
     * Create a request handler for a plugin route
     */
    public createHandler(
        instance: IPluginRouteInstance,
    ): (req: Request, res: Response) => Promise<void> {
        return async (req: Request, res: Response): Promise<void> => {
            try {
                // Check plugin is still enabled
                const plugin = this.registry.get(instance.pluginId);
                if (!plugin || plugin.state !== PluginState.ENABLED) {
                    res.status(503);
                    res.json({
                        error: 'Plugin not available',
                        code: 'PLUGIN_UNAVAILABLE',
                    });
                    return;
                }

                // Build request object for plugin
                const pluginRequest = {
                    method: req.method,
                    path: req.path,
                    query: req.query_parameters,
                    params: req.path_parameters,
                    body: await this.parseBody(req),
                    headers: this.getHeaders(req),
                };

                // Execute handler in plugin worker
                const result = await this.workerPool.executeRouteHandler(
                    instance.pluginId,
                    instance.handler,
                    pluginRequest,
                );

                if (!result.success) {
                    res.status(result.status || 500);
                    res.json({
                        error: result.error || 'Handler failed',
                        code: 'HANDLER_ERROR',
                    });
                    return;
                }

                // Parse result and send response
                let responseBody: unknown;
                try {
                    responseBody = JSON.parse(result.result) as unknown;
                } catch (parseError) {
                    this.error(
                        `Invalid JSON response from plugin ${instance.pluginId}/${instance.handler}: ${(parseError as Error).message}`,
                    );
                    res.status(500);
                    res.json({
                        error: 'Plugin returned invalid JSON response',
                        code: 'INVALID_RESPONSE_JSON',
                    });
                    return;
                }
                res.status(result.status || 200);
                res.json(responseBody);
            } catch (error) {
                const err = error as Error;
                this.error(
                    `Plugin route error for ${instance.pluginId}/${instance.handler}: ${err.message}`,
                );
                res.status(500);
                res.json({
                    error: 'Internal plugin error',
                    code: 'PLUGIN_ERROR',
                    message: err.message,
                });
            }
        };
    }

    /**
     * Get route instance by method and path
     */
    public getRoute(method: string, path: string): IPluginRouteInstance | undefined {
        return this.handlers.get(`${method}:${path}`);
    }

    /**
     * Check if a route exists
     */
    public hasRoute(method: string, path: string): boolean {
        return this.handlers.has(`${method}:${path}`);
    }

    /**
     * Notify all plugin routes of block change
     * Block notifications are dispatched through the HookDispatcher to plugin workers
     */
    public async notifyBlockChange(_blockHeight: bigint, _blockHash: string): Promise<void> {
        // Block notifications handled via HookDispatcher -> BLOCK_CHANGE hook
    }

    /**
     * Notify all plugin routes of epoch finalization
     * Epoch notifications are dispatched through the HookDispatcher to plugin workers
     */
    public async notifyEpochFinalized(_epochNumber: bigint): Promise<void> {
        // Epoch notifications handled via HookDispatcher -> EPOCH_FINALIZED hook
    }

    /**
     * Parse request body
     */
    private async parseBody(req: Request): Promise<unknown> {
        try {
            return await req.json();
        } catch {
            // Try text if JSON fails
            try {
                return await req.text();
            } catch {
                return null;
            }
        }
    }

    /**
     * Get headers from request
     */
    private getHeaders(req: Request): Record<string, string> {
        return req.headers;
    }
}
