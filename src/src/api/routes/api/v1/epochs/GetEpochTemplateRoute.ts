import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { EpochTemplateResult } from '../../../../json-rpc/types/interfaces/results/epochs/EpochTemplateResult.js';
import { EpochTemplateParams } from '../../../../json-rpc/types/interfaces/params/epochs/GetEpochTemplateParams.js';
import { OPNetConsensus } from '../../../../../poa/configurations/OPNetConsensus.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { SHA1 } from '../../../../../utils/SHA1.js';

export class GetEpochTemplateRoute extends Route<
    Routes.EPOCH_TEMPLATE,
    JSONRpcMethods.GET_EPOCH_TEMPLATE,
    EpochTemplateResult
> {
    constructor() {
        super(Routes.EPOCH_TEMPLATE, RouteType.GET);
    }

    public async getData(_params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized for GetEpochTemplate route');
        }

        const blockEpochInterval = BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);
        const latestBlockHeader = await this.storage.getLatestBlock();
        if (!latestBlockHeader) {
            throw new Error('No blocks found in storage');
        }

        const blockHeight = BigInt(latestBlockHeader.height);
        const epochNumber = blockHeight / blockEpochInterval;
        const startBlockHeight = blockEpochInterval * epochNumber;

        let blockHeader: BlockHeaderAPIBlockDocument;
        if (startBlockHeight === blockHeight) {
            blockHeader = latestBlockHeader;
        } else {
            const header = await this.storage.getBlockHeader(startBlockHeight);
            if (!header) throw new Error(`Block header not found for height ${startBlockHeight}`);

            blockHeader = this.storage.convertBlockHeaderToBlockHeaderDocument(header);
        }

        const target = blockHeader.checksumRoot;
        const targetHash = SHA1.hash(Buffer.from(target.replace('0x', ''), 'hex'));

        return {
            epochNumber: epochNumber.toString(),
            epochTarget: target,
            targetHash: targetHash,
        };
    }

    public async getDataRPC(params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        return await this.getData(params);
    }

    protected initialize(): void {
        // Initialize any required resources
    }

    /**
     * GET /api/v1/epoch/template
     * @tag Epoch
     * @summary Get a template for epoch mining.
     * @description Get the current epoch mining template with target hash and requirements.
     * @response 200 - Return the epoch template.
     * @response 400 - Something went wrong.
     * @response 501 - Not implemented.
     * @response default - Unexpected error
     * @responseContent {EpochTemplateResult} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const result = await this.getData();
            res.status(200);
            res.json(result);
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }
}
