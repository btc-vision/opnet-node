import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Config } from '../../../../../config/Config.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { ChainIdResult } from '../../../../json-rpc/types/interfaces/results/chain/ChainIdResult.js';
import { Route } from '../../../Route.js';

export class ChainId extends Route<Routes.CHAIN_ID, JSONRpcMethods.CHAIN_ID, ChainIdResult> {
    constructor() {
        super(Routes.CHAIN_ID, RouteType.GET);
    }

    public getData(): ChainIdResult {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        return `0x${this.getChainId().toString(16)}`;
    }

    public getDataRPC(): ChainIdResult {
        const data = this.getData();
        if (!data) throw new Error(`Failed to get chain ID`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/chain/id
     * @tag Chain
     * @summary Get the current chain ID
     * @description Get the current chain ID
     * @response 200 - The current chain ID
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {string} 200.application/json
     */
    protected onRequest(_req: Request, res: Response, _next?: MiddlewareNext): undefined {
        try {
            const data = this.getData();

            if (data) {
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: 'Something went wrong.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private getChainId(): number {
        // we convert this to number because it is a string
        return Config.BITCOIN.CHAIN_ID;
    }
}
