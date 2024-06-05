import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { BlockHeaderAPIDocumentWithTransactions } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { Routes } from '../../../../enums/Routes.js';
import { BlockByHashParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByHashParams.js';
import { BlockByIdResult } from '../../../../json-rpc/types/interfaces/results/blocks/BlockByIdResult.js';
import { SafeMath } from '../../../safe/SafeMath.js';
import { BlockRoute } from './BlockRoute.js';

export class BlockByHash extends BlockRoute<Routes.BLOCK_BY_HASH> {
    constructor() {
        super(Routes.BLOCK_BY_HASH);
    }

    public async getData(
        params: BlockByHashParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const blockHash = SafeMath.getParameterAsStringForBlock(params);
        const includeTransactions: boolean = this.getParameterAsBoolean(params);
        if (!blockHash) {
            throw new Error('Block hash not provided');
        }

        const cachedData = this.getCachedData(blockHash);
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

        const transactions = await this.storage.getBlockTransactions(
            undefined,
            blockHash,
            includeTransactions,
        );

        if (!transactions) return undefined;

        const data = await this.convertToBlockHeaderAPIDocumentWithTransactions(transactions);
        if (data) this.setToCache(blockHash, data);
        else this.currentBlockData = data;

        return data;
    }

    public async getDataRPC(params: BlockByHashParams): Promise<BlockByIdResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    /**
     * GET /api/v1/block/by-hash
     * @tag Block
     * @summary Get a block and its transactions by height.
     * @queryParam {string} [hash] - The height of the block to fetch.
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

            const hash = req.query.hash as string | undefined;
            if (!hash) {
                res.status(400);
                res.json({ error: 'Block hash not provided' });
                return;
            }

            const sendTransactions = req.query.sendTransactions === 'true';
            const data = await this.getData({
                blockHash: hash,
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
