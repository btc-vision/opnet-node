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
    private pendingBlockHeight: bigint | undefined;
    private cachedTemplatePromise: Promise<EpochTemplateResult> | undefined;
    private cacheValidForEpoch: bigint | undefined;
    private cacheTimestamp: number | undefined;

    private readonly CACHE_DURATION_MS = 5000;

    constructor() {
        super(Routes.EPOCH_TEMPLATE, RouteType.GET);
    }

    public async getData(_params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        if (!this.storage || this.pendingBlockHeight === undefined) {
            throw new Error('Route not properly initialized');
        }

        const currentEpoch = OPNetConsensus.calculateCurrentEpoch(this.pendingBlockHeight);
        const now = Date.now();

        if (
            this.cachedTemplatePromise &&
            this.cacheValidForEpoch === currentEpoch &&
            this.cacheTimestamp !== undefined &&
            now - this.cacheTimestamp < this.CACHE_DURATION_MS
        ) {
            return await this.cachedTemplatePromise;
        }

        this.cachedTemplatePromise = this.computeTemplate(this.pendingBlockHeight);

        return await this.cachedTemplatePromise;
    }

    public async getDataRPC(params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        return await this.getData(params);
    }

    public onBlockChange(blockHeight: bigint, _header: BlockHeaderAPIBlockDocument): void {
        const previousEpoch =
            this.pendingBlockHeight !== undefined
                ? OPNetConsensus.calculateCurrentEpoch(this.pendingBlockHeight)
                : undefined;

        const newEpoch = OPNetConsensus.calculateCurrentEpoch(blockHeight);
        this.pendingBlockHeight = blockHeight;

        if (previousEpoch !== undefined && previousEpoch !== newEpoch) {
            this.cachedTemplatePromise = undefined;
            this.cacheValidForEpoch = undefined;
            this.cacheTimestamp = undefined;
        }
    }

    protected async initialize(): Promise<void> {
        if (!this.storage) {
            throw new Error('Storage not initialized for GetEpochTemplate route');
        }

        // Get the current block height from storage
        try {
            const currentBlock = await this.storage.getLatestBlock();
            if (!currentBlock) {
                throw new Error('No blocks found in storage to determine current height');
            }

            this.pendingBlockHeight = BigInt(currentBlock.height);

            const currentEpoch = OPNetConsensus.calculateCurrentEpoch(this.pendingBlockHeight);
            if (currentEpoch > 0n) {
                this.cacheValidForEpoch = currentEpoch;
                this.cacheTimestamp = Date.now();
                this.cachedTemplatePromise = this.computeTemplate(this.pendingBlockHeight);

                try {
                    await this.cachedTemplatePromise;
                } catch (error) {
                    this.error(`Failed to pre-cache template during initialization: ${error}`);

                    this.cachedTemplatePromise = undefined;
                    this.cacheValidForEpoch = undefined;
                    this.cacheTimestamp = undefined;
                }
            }
        } catch {}
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

    private async computeTemplate(blockHeight: bigint): Promise<EpochTemplateResult> {
        if (!this.storage) {
            throw new Error('Storage not available for template computation');
        }

        const currentEpoch = blockHeight / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;
        if (currentEpoch === 0n) {
            throw new Error('Epoch 0 cannot be mined. Mining begins in epoch 1.');
        }

        const miningTargetBlock =
            currentEpoch * OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH - 1n;

        const blockHeader = await this.storage.getBlockHeader(miningTargetBlock);
        if (!blockHeader) {
            throw new Error(`Block header not found for mining target height ${miningTargetBlock}`);
        }

        this.cacheValidForEpoch = currentEpoch;
        this.cacheTimestamp = Date.now();

        return {
            epochNumber: currentEpoch.toString(),
            epochTarget: blockHeader.checksumRoot,
        };
    }
}
