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

export class GetEpochTemplateRoute extends Route<
    Routes.EPOCH_TEMPLATE,
    JSONRpcMethods.GET_EPOCH_TEMPLATE,
    EpochTemplateResult
> {
    private currentBlockHeight: bigint | undefined;

    constructor() {
        super(Routes.EPOCH_TEMPLATE, RouteType.GET);
    }

    public async getData(_params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized for GetEpochTemplate route');
        }

        if (!this.currentBlockHeight) {
            throw new Error(
                'Current block height is not set. Ensure the node is initialized and synced.',
            );
        }

        const blockEpochInterval = BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);
        const currentEpoch = this.currentBlockHeight / blockEpochInterval;

        // Next epoch to be finalized
        const nextEpochToFinalize = currentEpoch + 1n;

        // Get the mining target block (last block of current epoch)
        const targetBlockHeight = nextEpochToFinalize * blockEpochInterval - 1n;

        // Check if the target block exists yet
        if (targetBlockHeight > this.currentBlockHeight) {
            // Target block doesn't exist yet, miners need to wait
            throw new Error(
                `Mining target block ${targetBlockHeight} does not exist yet. ` +
                    `Current height is ${this.currentBlockHeight}. Wait until block ${targetBlockHeight} is created.`,
            );
        }

        const blockHeader = await this.storage.getBlockHeader(targetBlockHeight);
        if (!blockHeader) {
            throw new Error(`Block header not found for mining target height ${targetBlockHeight}`);
        }

        const target = blockHeader.checksumRoot;
        return {
            epochNumber: nextEpochToFinalize.toString(),
            epochTarget: target,
        };
    }

    public async getDataRPC(params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        return await this.getData(params);
    }

    public onBlockChange(blockHeight: bigint, _header: BlockHeaderAPIBlockDocument): void {
        console.log(blockHeight);

        this.currentBlockHeight = blockHeight - 1n;
    }

    protected async initialize(): Promise<void> {
        if (!this.storage) {
            throw new Error('Storage not initialized for SubmitEpoch route');
        }

        const currentBlock = await this.storage.getLatestBlock();
        if (!currentBlock) {
            throw new Error('No blocks found in storage to determine current height');
        }

        this.currentBlockHeight = BigInt(currentBlock.height);
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
