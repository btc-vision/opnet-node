import { DataConverter } from '@btc-vision/bsi-db';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { IReorgDocument } from '../../../../../db/interfaces/IReorgDocument.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import {
    BlockWitnessAsArray,
    BlockWitnessAsObject,
    BlockWitnessParams,
} from '../../../../json-rpc/types/interfaces/params/opnet/BlockWitnessParams.js';
import { ReorgResult } from '../../../../json-rpc/types/interfaces/results/chain/ReorgResult.js';
import { Route } from '../../../Route.js';

export class OPNetWitnessRoute extends Route<
    Routes.BLOCK_WITNESS,
    JSONRpcMethods.BLOCK_WITNESS,
    ReorgResult | undefined
> {
    constructor() {
        super(Routes.BLOCK_WITNESS, RouteType.GET);
    }

    public async getData(params: BlockWitnessParams): Promise<ReorgResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        /*const [fromBlock, toBlock] = this.getDecodedParams(params);
        const rawResult: IReorgDocument[] | undefined = await this.storage.getReorgs(
            fromBlock,
            toBlock,
        );

        return rawResult ? this.parseRawResult(rawResult) : [];*/
    }

    public async getDataRPC(params: BlockWitnessParams): Promise<ReorgResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Contract bytecode not found at the specified address.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/block/witness
     * @tag Block
     * @summary
     * @description
     * @queryParam
     * @response 200 -
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const params = this.getParams(req, res);
            if (!params) return;

            const data = await this.getData(params);

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

    protected getParams(req: Request, res: Response): BlockWitnessAsObject | undefined {
        const height = req.query.height as string | undefined;
        if (height === undefined) {
            res.status(400);
            res.json({ error: 'Height is required' });
            return undefined;
        }

        const bigintHeight = height ? BigInt(height) : -1;
        const trusted: boolean | undefined = req.query.trusted
            ? req.query.trusted === 'true'
            : undefined;

        const limit: number | undefined = req.query.limit
            ? parseInt(req.query.limit as string)
            : undefined;

        const page: number | undefined = req.query.page
            ? parseInt(req.query.page as string)
            : undefined;

        return {
            height: bigintHeight,
            trusted: trusted,
            limit: limit,
            page: page,
        };
    }

    private getDecodedParams(params: BlockWitnessParams): BlockWitnessAsArray {
        const


        if (Array.isArray(params)) {
            return params;
        }

        return [params.height, params.trusted, params.limit, params.page];
    }
}
