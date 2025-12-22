import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpc2Manager } from '../../../../json-rpc/JSONRpc2Manager.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { JSONRpc2Result } from '../../../../json-rpc/types/interfaces/JSONRpc2Result.js';
import { Route } from '../../../Route.js';

export class JSONRpc extends Route<
    Routes.JSON_RPC,
    JSONRpcMethods,
    JSONRpc2Result<JSONRpcMethods> | undefined
> {
    private readonly rpcManager: JSONRpc2Manager = new JSONRpc2Manager();

    constructor() {
        super(Routes.JSON_RPC, RouteType.POST);
    }

    public getData(): JSONRpc2Result<JSONRpcMethods> | undefined {
        return undefined;
    }

    public onBlockChange(_blockNumber: bigint): void {}

    protected initialize(): void {}

    /**
     * POST /api/v1/json-rpc
     * @tag OP_NET
     * @summary This route allow you to interact with the api via JSON-RPC.
     * @description Handle internal routing via JSON-RPC v2.
     * @bodyContent {object} application/json
     * @response 200 - Returns the result of the JSON-RPC method as a JSON-RPC v2 response.
     * @response 400 - Something went wrong. Returns a JSON-RPC v2 error response.
     * @response 500 - Internal error. Returns a JSON-RPC v2 error response.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        await this.rpcManager.onRequest(req, res);
    }
}
