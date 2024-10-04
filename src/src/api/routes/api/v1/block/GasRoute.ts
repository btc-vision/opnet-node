import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { BlockGasInformation } from '../../../../json-rpc/types/interfaces/results/blocks/BlockGasInformation.js';
import { OPNetConsensus } from '../../../../../poa/configurations/OPNetConsensus.js';
import { BlockGasPredictor } from '../../../../../blockchain-indexer/processor/gas/BlockGasPredictor.js';

export class GasRoute extends Route<Routes.GAS, JSONRpcMethods.GAS, BlockGasInformation> {
    private cachedBlock:
        | Promise<BlockHeaderAPIBlockDocument | undefined>
        | BlockHeaderAPIBlockDocument
        | undefined;

    constructor() {
        super(Routes.GAS, RouteType.GET);
    }

    public async getData(): Promise<BlockGasInformation> {
        const latestBlock = await this.getBlockHeader();
        if (!latestBlock)
            throw new Error('Could not fetch latest block header. Is this node synced?');

        const gasUsed: bigint = BigInt(latestBlock.gasUsed);
        const ema: bigint = BigInt(latestBlock.ema);
        const baseGas: bigint = BigInt(latestBlock.baseGas);

        const gasPerSat: bigint =
            (OPNetConsensus.consensus.GAS.SAT_TO_GAS_RATIO * baseGas) /
                BlockGasPredictor.scalingFactor +
            1n;

        return {
            blockNumber: this.bigIntToHex(BigInt(latestBlock.height)),
            gasUsed: this.bigIntToHex(gasUsed),
            targetGasLimit: this.bigIntToHex(OPNetConsensus.consensus.GAS.TARGET_GAS),
            gasLimit: this.bigIntToHex(OPNetConsensus.consensus.GAS.MAX_THEORETICAL_GAS),

            ema: this.bigIntToHex(ema),
            baseGas: this.bigIntToHex(baseGas),

            gasPerSat: this.bigIntToHex(gasPerSat),
        };
    }

    public async getDataRPC(): Promise<BlockGasInformation> {
        const data = await this.getData();
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    public onBlockChange(_blockNumber: bigint, blockHeader: BlockHeaderAPIBlockDocument): void {
        this.cachedBlock = blockHeader;
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

    private bigIntToHex(value: bigint): string {
        return `0x${value.toString(16)}`;
    }

    private async getBlockHeader(): Promise<BlockHeaderAPIBlockDocument | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        if (this.cachedBlock) {
            return this.cachedBlock;
        }

        this.cachedBlock = this.storage.getLatestBlock();

        return await this.cachedBlock;
    }
}
