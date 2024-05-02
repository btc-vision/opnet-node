import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { CallParams } from '../../../../json-rpc/types/interfaces/params/states/CallParams.js';
import { CallResult } from '../../../../json-rpc/types/interfaces/results/states/CallResult.js';
import { Route } from '../../../Route.js';

export class Call extends Route<Routes.CALL, JSONRpcMethods.CALL, CallResult | undefined> {
    constructor() {
        super(Routes.CALL, RouteType.GET);
    }

    public async getData(_params: CallParams): Promise<CallResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const latestBlock = await this.storage.getLatestBlock();

        return {
            height: latestBlock?.height || '0',
        };
    }

    public async getDataRPC(params: CallParams): Promise<CallResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/states/call
     * @tag States
     * @summary Call a contract function with a given calldata.
     * @description Call a contract function with the given address, data, and value.
     * @queryParam {string} address - The address of the contract.
     * @queryParam {string} data - The calldata of the contract function.
     * @response 200 - Return the result of the contract function call.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const params = this.getParams(req, res);
            if (!params) return;

            const data = await this.getData(params);

            if (data) {
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: 'Could not fetch latest block header. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): CallParams | undefined {
        return;
    }
}
