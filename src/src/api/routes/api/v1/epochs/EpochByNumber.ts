import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes } from '../../../../enums/Routes.js';
import { EpochByNumberParams } from '../../../../json-rpc/types/interfaces/params/epochs/EpochByNumberParams.js';
import { EpochAPIResult } from '../../../../json-rpc/types/interfaces/results/epochs/EpochResult.js';
import { EpochRoute } from './EpochRoute.js';

export class EpochByNumber extends EpochRoute<Routes.EPOCH_BY_NUMBER> {
    constructor() {
        super(Routes.EPOCH_BY_NUMBER);
    }

    public async getData(params: EpochByNumberParams): Promise<EpochAPIResult | undefined> {
        this.incrementPendingRequests();

        let data: Promise<EpochAPIResult>;
        try {
            const validatedParams = this.validateEpochParams(params);
            const includeSubmissions = validatedParams.includeSubmissions;
            const epochNumber = validatedParams.epochNumber;

            if (epochNumber === undefined) {
                throw new Error('Epoch number not provided');
            }

            data = this.getCachedEpochData(includeSubmissions, epochNumber);
        } catch (e) {
            this.decrementPendingRequests();
            throw new Error('Something went wrong.');
        }

        this.decrementPendingRequests();
        return data;
    }

    public async getDataRPC(params: EpochByNumberParams): Promise<EpochAPIResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Epoch not found at given number.`);

        return data;
    }

    /**
     * GET /api/v1/epoch/by-number
     * @tag Epoch
     * @summary Get an epoch by its number.
     * @queryParam {integer} [height] - The number of the epoch to fetch (-1 for latest).
     * @queryParam {boolean} [includeSubmissions] - Whether to include submissions in the response.
     * @description Get the requested epoch and optionally its submissions.
     * @response 200 - Return the requested epoch.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {EpochAPIResult} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            if (!req.query) {
                throw new Error('Invalid params.');
            }

            const height = req.query.height as string | undefined;
            const epochNumber = height ? BigInt(height) : -1n;
            const includeSubmissions = req.query.includeSubmissions === 'true';

            const data = await this.getData({
                height: epochNumber,
                includeSubmissions: includeSubmissions,
            });

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch epoch. Does it exist?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }
}
