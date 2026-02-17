import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes } from '../../../../enums/Routes.js';
import { EpochByHashParams } from '../../../../json-rpc/types/interfaces/params/epochs/EpochByHashParams.js';
import { EpochAPIResult } from '../../../../json-rpc/types/interfaces/results/epochs/EpochResult.js';
import { EpochRoute } from './EpochRoute.js';

export class EpochByHash extends EpochRoute<Routes.EPOCH_BY_HASH> {
    constructor() {
        super(Routes.EPOCH_BY_HASH);
    }

    public async getData(params: EpochByHashParams): Promise<EpochAPIResult | undefined> {
        this.incrementPendingRequests();

        let data: Promise<EpochAPIResult>;
        try {
            const validatedParams = this.validateEpochParams(params);
            const includeSubmissions = validatedParams.includeSubmissions;
            const epochHash = validatedParams.epochHash;

            if (!epochHash) {
                throw new Error('Epoch hash not provided');
            }

            data = this.getCachedEpochData(includeSubmissions, undefined, epochHash);
        } catch (e) {
            this.decrementPendingRequests();
            throw new Error('Something went wrong.', { cause: e });
        }

        this.decrementPendingRequests();
        return data;
    }

    public async getDataRPC(params: EpochByHashParams): Promise<EpochAPIResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Epoch not found with given hash.`);

        return data;
    }

    /**
     * GET /api/v1/epoch/by-hash
     * @tag Epoch
     * @summary Get an epoch by its hash.
     * @queryParam {string} [hash] - The hash of the epoch to fetch.
     * @queryParam {boolean} [includeSubmissions] - Whether to include submissions in the response.
     * @description Get the requested epoch by its hash and optionally its submissions.
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

            const hash = req.query.hash as string | undefined;
            if (!hash) {
                this.safeJson(res, 400, { error: 'Epoch hash not provided' });
                return;
            }

            const includeSubmissions = req.query.includeSubmissions === 'true';

            const data = await this.getData({
                hash: hash,
                includeSubmissions: includeSubmissions,
            });

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch epoch with the provided hash.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }
}
