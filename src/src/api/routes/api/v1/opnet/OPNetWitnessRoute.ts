import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { IParsedBlockWitnessDocument } from '../../../../../db/models/IBlockWitnessDocument.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import {
    BlockWitnessAsArray,
    BlockWitnessAsObject,
    BlockWitnessParams,
} from '../../../../json-rpc/types/interfaces/params/opnet/BlockWitnessParams.js';
import {
    BlockWitnessResult,
    IBlockWitnessAPI,
    IBlockWitnessResultAPI,
} from '../../../../json-rpc/types/interfaces/results/opnet/BlockWitnessResult.js';
import { Route } from '../../../Route.js';

export class OPNetWitnessRoute extends Route<
    Routes.BLOCK_WITNESS,
    JSONRpcMethods.BLOCK_WITNESS,
    BlockWitnessResult | undefined
> {
    constructor() {
        super(Routes.BLOCK_WITNESS, RouteType.GET);
    }

    public async getData(params: BlockWitnessParams): Promise<BlockWitnessResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        // eslint-disable-next-line prefer-const
        let [height, trusted, limit, page] = this.getDecodedParams(params);
        if (typeof height === 'string') height = BigInt(height);

        const witnesses: IParsedBlockWitnessDocument[] = await this.storage.getWitnesses(
            height,
            trusted,
            limit,
            page,
        );

        if (!witnesses) return undefined;

        return this.parseResult(witnesses);
    }

    public async getDataRPC(params: BlockWitnessParams): Promise<BlockWitnessResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Contract bytecode not found at the specified address.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/block/block-witness
     * @tag Block
     * @summary Get block witness
     * @description Return a list of opnet block witnesses
     * @queryParam height {number} Height of the block
     * @queryParam [trusted] {boolean} Trusted block
     * @queryParam [limit] {number} Limit of witnesses
     * @queryParam [page] {number} Page number
     * @response 200 - Returns the block witnesses
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const params = this.getParams(req, res);
            if (!params) {
                throw new Error('Invalid params.');
            }

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
        if (!req.query) {
            throw new Error('Invalid params.');
        }

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

    private parseResult(witnesses: IParsedBlockWitnessDocument[]): BlockWitnessResult {
        const result: IBlockWitnessResultAPI = {};

        for (const witness of witnesses) {
            const blockNumber: string = witness.blockNumber.toString();

            if (!result[blockNumber]) {
                result[blockNumber] = [];
            }

            const parsedWitness: IBlockWitnessAPI = {
                signature: witness.signature.toString('base64'),
                publicKey: witness.publicKey?.toString('base64'),
                timestamp: witness.timestamp.getTime(),
                proofs: witness.proofs?.map((proof) => proof.toString('base64')) || [],
                identity: witness.identity,
                trusted: witness.trusted,
            };

            result[blockNumber].push(parsedWitness);
        }

        return Object.keys(result).map((blockNumber) => {
            return {
                blockNumber,
                witnesses: result[blockNumber],
            };
        });
    }

    private getDecodedParams(params: BlockWitnessParams): BlockWitnessAsArray {
        let height: bigint | -1 | string = -1;
        let trusted: boolean | undefined;
        let limit: number | undefined;
        let page: number | undefined;

        if (Array.isArray(params)) {
            height = params[0];
            trusted = params[1];
            limit = params[2];
            page = params[3];
        } else {
            height = params.height;
            trusted = params.trusted;
            limit = params.limit;
            page = params.page;
        }

        return [height, trusted, limit, page];
    }
}
