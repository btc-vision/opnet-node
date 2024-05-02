import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByNumberResult } from '../../../../json-rpc/types/interfaces/results/blocks/BlockByNumberResult.js';
import { Route } from '../../../Route.js';

export class LatestBlock extends Route<
    Routes.LATEST_BLOCK,
    JSONRpcMethods.BLOCK_BY_NUMBER,
    BlockByNumberResult | undefined
> {
    constructor() {
        super(Routes.LATEST_BLOCK, RouteType.GET);
    }

    public async getData(): Promise<BlockByNumberResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const latestBlock = await this.storage.getLatestBlock();

        return {
            height: latestBlock?.height || '0',
        };
    }

    public async getDataRPC(): Promise<BlockByNumberResult | undefined> {
        const data = await this.getData();
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/block/latest
     * @tag Block
     * @summary Get the current heap block of OpNet
     * @description Get the current heap block of OpNet (the block that is currently being processed)
     * @response 200 - Return the current heap block of the Bitcoin blockchain.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {{height: string}} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const data = await this.getData();

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
}