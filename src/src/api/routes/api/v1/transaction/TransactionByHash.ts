import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { ITransactionDocument } from '../../../../../db/interfaces/ITransactionDocument.js';
import { TransactionConverterForAPI } from '../../../../data-converter/TransactionConverterForAPI.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { TransactionByHashParams } from '../../../../json-rpc/types/interfaces/params/transactions/TransactionByHashParams.js';
import { TransactionByHashResult } from '../../../../json-rpc/types/interfaces/results/transactions/TransactionByHashResult.js';
import { Route } from '../../../Route.js';

export class TransactionByHash extends Route<
    Routes.TRANSACTION_BY_HASH,
    JSONRpcMethods.GET_TRANSACTION_BY_HASH,
    TransactionByHashResult | undefined
> {
    constructor() {
        super(Routes.TRANSACTION_BY_HASH, RouteType.GET);
    }

    public async getData(
        params: TransactionByHashParams,
    ): Promise<TransactionByHashResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [hash] = this.getDecodedParams(params);
        const data = await this.storage.getTransactionByHash(hash);

        if (!data) {
            return undefined;
        }

        return this.convertRawTransactionData(data);
    }

    public async getDataRPC(
        params: TransactionByHashParams,
    ): Promise<TransactionByHashResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not find the transaction with the provided hash.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/transaction/by-hash
     * @tag Transactions
     * @summary Get a transaction by hash
     * @description Get the detailed information of a transaction by it's hash.
     * @queryParam {string} hash - The hash of the transaction.
     * @response 200 - Return the transaction details.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {GenericTransaction} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const params = this.getParams(_req, res);
            if (!params) {
                throw new Error('Invalid params.');
            }

            const data = await this.getData(params);

            if (data) {
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: 'Transaction not found.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): TransactionByHashParams | undefined {
        if (!req.query) {
            throw new Error('Invalid params.');
        }

        const hash = req.query.hash as string;

        if (!hash || (hash && hash.length !== 64)) {
            res.status(400);
            res.json({ error: 'Invalid hash.' });
            return;
        }

        return {
            hash,
        };
    }

    private convertRawTransactionData(
        data: ITransactionDocument<OPNetTransactionTypes>,
    ): TransactionByHashResult {
        return TransactionConverterForAPI.convertTransactionToAPI(data);
    }

    private getDecodedParams(params: TransactionByHashParams): [string] {
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
