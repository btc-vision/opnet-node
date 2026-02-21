import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { GetMempoolInfoParams } from '../../../../json-rpc/types/interfaces/params/mempool/GetMempoolInfoParams.js';
import { GetMempoolInfoResult } from '../../../../json-rpc/types/interfaces/results/mempool/GetMempoolInfoResult.js';
import { Route } from '../../../Route.js';

/**
 * Route handler that returns live mempool statistics (total count, OPNet count, byte size).
 */
export class GetMempoolInfo extends Route<
    Routes.MEMPOOL_INFO,
    JSONRpcMethods.GET_MEMPOOL_INFO,
    GetMempoolInfoResult
> {
    constructor() {
        super(Routes.MEMPOOL_INFO, RouteType.GET);
    }

    /**
     * Fetches aggregate mempool statistics from storage.
     *
     * @param _params - Unused; the endpoint accepts no parameters.
     * @returns Mempool info containing total count, OPNet count, and byte size.
     * @throws If storage is not initialised.
     */
    public async getData(_params?: GetMempoolInfoParams): Promise<GetMempoolInfoResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const info = await this.storage.getMempoolInfo();

        return {
            count: info.count,
            opnetCount: info.opnetCount,
            size: info.size,
        };
    }

    /** {@inheritDoc Route.getDataRPC} */
    public async getDataRPC(_params?: GetMempoolInfoParams): Promise<GetMempoolInfoResult> {
        return await this.getData();
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/mempool/info
     * @tag Mempool
     * @summary Get mempool information
     * @description Returns live mempool statistics including transaction count and OPNet breakdown.
     * @response 200 - Returns mempool info.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {MempoolInfoData} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const data = await this.getData();

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch mempool info.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }
}
