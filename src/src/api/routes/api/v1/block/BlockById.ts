import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import {
    BlockHeaderAPIDocumentWithTransactions,
    BlockWithTransactions,
} from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { Routes } from '../../../../enums/Routes.js';
import { BlockByIdParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByIdParams.js';
import { BlockByIdResult } from '../../../../json-rpc/types/interfaces/results/blocks/BlockByIdResult.js';
import { SafeBigInt, SafeMath } from '../../../safe/SafeMath.js';
import { BlockRoute } from './BlockRoute.js';

export class BlockById extends BlockRoute<Routes.BLOCK_BY_ID> {
    constructor() {
        super(Routes.BLOCK_BY_ID);
    }

    public async getData(
        params: BlockByIdParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined> {
        this.incrementPendingRequests();

        let data: Promise<BlockHeaderAPIDocumentWithTransactions>;
        try {
            const height: SafeBigInt = SafeMath.getParameterAsBigIntForBlock(params);
            const includeTransactions: boolean = this.getParameterAsBoolean(params);

            const cachedData = await this.getCachedData(height);
            if (cachedData) {
                if (!includeTransactions && cachedData.transactions.length !== 0) {
                    return {
                        ...cachedData,
                        transactions: [],
                    };
                } else if (includeTransactions && cachedData.transactions.length === 0) {
                } else {
                    return cachedData;
                }
            }

            if (!this.storage) {
                throw new Error('Storage not initialized');
            }

            const transactions: BlockWithTransactions | undefined =
                await this.storage.getBlockTransactions(height, undefined, includeTransactions);
            if (!transactions) return undefined;

            data = this.convertToBlockHeaderAPIDocumentWithTransactions(transactions);
            if (height !== -1) {
                this.setToCache(height, data);
            } else {
                this.currentBlockData = data;
            }
        } catch (e) {
            this.decrementPendingRequests();

            throw new Error('Something went wrong.');
        }

        this.decrementPendingRequests();

        return data;
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
