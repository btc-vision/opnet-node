import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByNumberResult } from '../../../../json-rpc/types/interfaces/results/blocks/BlockByNumberResult.js';
import { Route } from '../../../Route.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';

export class LatestBlock extends Route<
    Routes.LATEST_BLOCK,
    JSONRpcMethods.BLOCK_BY_NUMBER,
    BlockByNumberResult
> {
    private cachedBlock: Promise<string | undefined> | string | undefined;

    constructor() {
        super(Routes.LATEST_BLOCK, RouteType.GET);
    }

    public async getData(): Promise<BlockByNumberResult> {
        const resp = await this.getBlockHeader();
        if (!resp) throw new Error(`Block not found at given height.`);

        return resp;
    }

    public async getDataRPC(): Promise<BlockByNumberResult> {
        return await this.getData();
    }

    public onBlockChange(_blockNumber: bigint, blockHeader: BlockHeaderAPIBlockDocument): void {
        this.cachedBlock = `0x${BigInt(blockHeader.height || '0').toString(16)}`;
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
     * @responseContent {string} 200.application/json
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

    private async getBlockNumber(): Promise<string | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const block = await this.storage.getLatestBlock();
        if (!block) {
            throw new Error('Block header not found at height ${height}.');
        }

        return `0x${BigInt(block.height || '0').toString(16)}`;
    }

    private async getBlockHeader(): Promise<string | undefined> {
        if (this.cachedBlock) {
            return this.cachedBlock;
        }

        this.cachedBlock = this.getBlockNumber();

        return await this.cachedBlock;
    }
}
