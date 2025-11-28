import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { BlockHeaderAPIDocumentWithTransactions } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { Routes } from '../../../../enums/Routes.js';
import { BlockByIdResult } from '../../../../json-rpc/types/interfaces/results/blocks/BlockByIdResult.js';
import { BlockRoute } from './BlockRoute.js';
import { BlockParamsConverter, SafeString } from '../../../safe/BlockParamsConverter.js';
import { BlockByChecksumParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByChecksumParams.js';
import { Config } from '../../../../../config/Config.js';

export class BlockByChecksum extends BlockRoute<Routes.BLOCK_BY_CHECKSUM> {
    constructor() {
        super(Routes.BLOCK_BY_CHECKSUM);
    }

    public async getData(
        params: BlockByChecksumParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined> {
        this.incrementPendingRequests();

        let data: Promise<BlockHeaderAPIDocumentWithTransactions>;
        try {
            let blockChecksum: SafeString =
                BlockParamsConverter.getParameterAsStringForBlock(params);

            blockChecksum = blockChecksum ? blockChecksum.replace('0x', '').toLowerCase() : null;

            const includeTransactions: boolean = this.getParameterAsBoolean(params);
            if (!blockChecksum) {
                throw new Error(
                    `Could not find the block with the provided checksum ${blockChecksum}.`,
                );
            }

            if (blockChecksum.length !== 64) throw new Error(`Invalid checksum length`);

            data = this.getCachedBlockData(includeTransactions, undefined, blockChecksum, true);
        } catch (e) {
            this.decrementPendingRequests();

            if (Config.DEV_MODE) {
                this.error(`Error details: ${(e as Error).stack}`);
            }

            throw new Error(`Something went wrong.`);
        }

        this.decrementPendingRequests();

        return data;
    }

    public async getDataRPC(params: BlockByChecksumParams): Promise<BlockByIdResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    /**
     * GET /api/v1/block/by-checksum
     * @tag Block
     * @summary Get a block and its transactions by height.
     * @queryParam {string} [hash] - The block checksum to search for.
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
