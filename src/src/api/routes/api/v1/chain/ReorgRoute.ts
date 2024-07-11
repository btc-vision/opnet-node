import { DataConverter } from '@btc-vision/bsi-db';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { IReorgDocument } from '../../../../../db/interfaces/IReorgDocument.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { ReorgParams } from '../../../../json-rpc/types/interfaces/params/chain/ReorgParams.js';
import { ReorgResult } from '../../../../json-rpc/types/interfaces/results/chain/ReorgResult.js';
import { Route } from '../../../Route.js';

export class ReorgRoute extends Route<Routes.REORG, JSONRpcMethods.REORG, ReorgResult | undefined> {
    constructor() {
        super(Routes.REORG, RouteType.GET);
    }

    public async getData(params: ReorgParams): Promise<ReorgResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [fromBlock, toBlock] = this.getDecodedParams(params);
        const rawResult: IReorgDocument[] | undefined = await this.storage.getReorgs(
            fromBlock,
            toBlock,
        );

        return rawResult ? this.parseRawResult(rawResult) : [];
    }

    public async getDataRPC(params: ReorgParams): Promise<ReorgResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Contract bytecode not found at the specified address.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/chain/reorg
     * @tag Chain
     * @summary Get the reorgs between two blocks.
     * @description Get reorgs that happened on chain. You can optionally specify the range of blocks to get reorgs for.
     * @queryParam {string} [fromBlock] - The block number to start from.
     * @queryParam {string} [toBlock] - The block number to end at.
     * @response 200 - The reorgs between the two blocks or an empty array if no reorgs were found.
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

    protected getParams(req: Request, res: Response): ReorgParams | undefined {
        if (!req.query) {
            throw new Error('Invalid params.');
        }

        const fromBlock = req.query.fromBlock as string | undefined;
        const toBlock = req.query.toBlock as string | undefined;

        return {
            fromBlock,
            toBlock,
        };
    }

    private parseRawResult(rawResult: IReorgDocument[]): ReorgResult {
        return rawResult.map((reorg) => {
            return {
                fromBlock: DataConverter.fromDecimal128(reorg.fromBlock).toString(16),
                toBlock: DataConverter.fromDecimal128(reorg.toBlock).toString(16),
                timestamp: reorg.timestamp.getTime(),
            };
        });
    }

    private getDecodedParams(params: ReorgParams): [bigint?, bigint?] {
        let fromBlockStr: string | undefined;
        let toBlockStr: string | undefined;

        if (Array.isArray(params)) {
            fromBlockStr = params[0];
            toBlockStr = params[1];
        } else {
            fromBlockStr = params.fromBlock;
            toBlockStr = params.toBlock;
        }

        const fromBlock = fromBlockStr ? BigInt(fromBlockStr) : undefined;
        const toBlock = toBlockStr ? BigInt(toBlockStr) : undefined;

        return [fromBlock, toBlock];
    }
}
