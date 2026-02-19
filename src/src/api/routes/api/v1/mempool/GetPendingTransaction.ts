import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { GetPendingTransactionParams } from '../../../../json-rpc/types/interfaces/params/mempool/GetPendingTransactionParams.js';
import { GetPendingTransactionResult } from '../../../../json-rpc/types/interfaces/results/mempool/GetPendingTransactionResult.js';
import { Route } from '../../../Route.js';
import { MempoolTransactionConverter } from './MempoolTransactionConverter.js';

/**
 * Route handler that retrieves a single pending mempool transaction by its hash.
 */
export class GetPendingTransaction extends Route<
    Routes.MEMPOOL_TRANSACTION,
    JSONRpcMethods.GET_PENDING_TRANSACTION,
    GetPendingTransactionResult
> {
    constructor() {
        super(Routes.MEMPOOL_TRANSACTION, RouteType.GET);
    }

    /**
     * Fetches a single pending transaction from the mempool.
     *
     * @param params - Must contain the 64-character hex transaction hash.
     * @returns The transaction data converted to the API response shape.
     * @throws If storage is not initialised, the hash is invalid, or the transaction is not found.
     */
    public async getData(
        params: GetPendingTransactionParams,
    ): Promise<GetPendingTransactionResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [hash] = this.getDecodedParams(params);
        if (hash.length !== 64) throw new Error(`Invalid hash length: ${hash.length}`);

        const tx = await this.storage.getMempoolTransaction(hash);
        if (!tx) {
            throw new Error(`Pending transaction ${hash} not found.`);
        }

        return MempoolTransactionConverter.convert(tx) as GetPendingTransactionResult;
    }

    /** {@inheritDoc Route.getDataRPC} */
    public async getDataRPC(
        params: GetPendingTransactionParams,
    ): Promise<GetPendingTransactionResult | undefined> {
        return await this.getData(params);
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/mempool/transaction
     * @tag Mempool
     * @summary Get a pending transaction by hash
     * @description Get the detailed information of a pending mempool transaction by its hash.
     * @queryParam {string} hash - The hash of the transaction.
     * @response 200 - Returns the pending transaction details.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {MempoolTransactionData} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const params = this.getParams(_req, res);
            if (!params) {
                return;
            }

            const data = await this.getData(params);

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Pending transaction not found.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    /**
     * Extracts and validates the transaction hash from the HTTP query string.
     *
     * @param req - The incoming HTTP request.
     * @param res - The HTTP response (used for error replies).
     * @returns Parsed parameters, or `undefined` when the hash is missing / invalid.
     */
    protected getParams(req: Request, res: Response): GetPendingTransactionParams | undefined {
        if (!req.query) {
            throw new Error('Invalid params.');
        }

        const hash = req.query.hash as string;

        if (!hash || (hash && hash.length !== 64)) {
            this.safeJson(res, 400, { error: 'Invalid hash.' });
            return;
        }

        return {
            hash,
        };
    }

    /**
     * Normalises both array-style and object-style RPC parameters.
     *
     * @param params - Raw RPC parameters.
     * @returns A single-element tuple containing the validated hash string.
     * @throws If the hash is missing.
     */
    private getDecodedParams(params: GetPendingTransactionParams): [string] {
        let hash: string | undefined;

        if (Array.isArray(params)) {
            hash = params.shift();
        } else {
            hash = params.hash;
        }

        if (!hash) throw new Error(`Invalid hash.`);

        return [hash];
    }
}
