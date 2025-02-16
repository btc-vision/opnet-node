import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { PreimageResult } from '../../../../json-rpc/types/interfaces/results/transactions/PreimageResult.js';

export class GetPreimage extends Route<
    Routes.TRANSACTION_PREIMAGE,
    JSONRpcMethods.TRANSACTION_PREIMAGE,
    PreimageResult
> {
    private cachedBlock: Promise<string | undefined> | string | undefined;

    constructor() {
        super(Routes.TRANSACTION_PREIMAGE, RouteType.GET);
    }

    public async getData(): Promise<PreimageResult> {
        const resp = await this.getBlockHeader();
        if (!resp) throw new Error(`No preimage found.`);

        return resp;
    }

    public async getDataRPC(): Promise<PreimageResult> {
        return await this.getData();
    }

    public onBlockChange(_blockNumber: bigint, _blockHeader: BlockHeaderAPIBlockDocument): void {
        this.cachedBlock = this.getPreimage();
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/transaction/preimage
     * @tag Block
     * @summary Get the latest preimage to use inside an OPNet transaction
     * @description Get the latest preimage to use inside an OPNet transaction
     * @response 200 - The preimage
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

    private async getPreimage(): Promise<string | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const block = await this.storage.getLatestBlock();
        if (!block) {
            throw new Error('Block header not found at height ${height}.');
        }

        return await this.storage.getPreimage(BigInt(block.height));
    }

    private async getBlockHeader(): Promise<string | undefined> {
        if (this.cachedBlock) {
            return this.cachedBlock;
        }

        this.cachedBlock = this.getPreimage();

        return await this.cachedBlock;
    }
}
