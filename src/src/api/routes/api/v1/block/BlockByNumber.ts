import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { BlockHeaderAPIDocumentWithTransactions } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { Routes } from '../../../../enums/Routes.js';
import { BlockByIdParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByIdParams.js';
import { BlockByIdResult } from '../../../../json-rpc/types/interfaces/results/blocks/BlockByIdResult.js';
import { BlockParamsConverter, SafeBigInt } from '../../../safe/BlockParamsConverter.js';
import { BlockRoute } from './BlockRoute.js';
import { Config } from '../../../../../config/Config.js';

export class BlockByNumber extends BlockRoute<Routes.BLOCK_BY_ID> {
    constructor() {
        super(Routes.BLOCK_BY_ID);
    }

    public async getData(
        params: BlockByIdParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined> {
        this.incrementPendingRequests();

        try {
            const height: SafeBigInt = BlockParamsConverter.getParameterAsBigIntForBlock(params);
            const includeTransactions: boolean = this.getParameterAsBoolean(params);

            return await this.getCachedBlockData(includeTransactions, height);
        } catch (e) {
            if (Config.DEV_MODE) {
                this.error(`Error details: ${(e as Error).stack}`);
            }

            throw new Error('Something went wrong.', { cause: e });
        } finally {
            this.decrementPendingRequests();
        }
    }

    public async getDataRPC(params: BlockByIdParams): Promise<BlockByIdResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    /**
     * GET /api/v1/block/by-id
     * @tag Block
     * @summary Get a block and its transactions by height.
     * @queryParam {integer} [height] - The height of the block to fetch.
     * @queryParam {boolean} [sendTransactions] - Whether to include transactions in the response.
     * @description Get the requested block and its transactions.
     * @response 200 - Return the requested block and its transactions.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {Block} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            if (!req.query) {
                throw new Error('Invalid params.');
            }

            const height = req.query.height as string | undefined;
            const bigintHeight = height ? BigInt(height) : -1;

            const sendTransactions = req.query.sendTransactions === 'true';
            const data = await this.getData({
                height: bigintHeight,
                sendTransactions: sendTransactions,
            });

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch latest block header. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }
}
