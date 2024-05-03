import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    InteractionTransactionDocument,
    ITransactionDocument,
} from '../../../../../db/interfaces/ITransactionDocument.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { TransactionReceiptsParams } from '../../../../json-rpc/types/interfaces/params/transactions/TransactionReceiptsParams.js';
import {
    TransactionReceiptResult,
    TransactionReceiptResultAPI,
} from '../../../../json-rpc/types/interfaces/results/transactions/TransactionReceiptResult.js';
import { Route } from '../../../Route.js';

export class TransactionReceipt extends Route<
    Routes.TRANSACTION_RECEIPT,
    JSONRpcMethods.GET_TRANSACTION_RECEIPT,
    TransactionReceiptResult | undefined
> {
    constructor() {
        super(Routes.TRANSACTION_RECEIPT, RouteType.GET);
    }

    public async getData(
        params: TransactionReceiptsParams,
    ): Promise<TransactionReceiptResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [hash] = this.getDecodedParams(params);
        const data = await this.storage.getTransactionByHash(hash);

        if (!data) {
            return undefined;
        }

        return this.getReceipt(data);
    }

    public async getDataRPC(
        params: TransactionReceiptsParams,
    ): Promise<TransactionReceiptResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not find the transaction with the provided hash.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/transaction/receipt
     * @tag Transactions
     * @summary Get a transaction receipt and events.
     * @description Get the receipt and the events of a transaction by it's hash.
     * @queryParam {string} hash - The hash of the transaction.
     * @response 200 - Return the transaction receipt and events.
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
                res.json({ error: 'Could not find the transaction with the provided hash.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): TransactionReceiptsParams | undefined {
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

    private getReceipt(
        data: ITransactionDocument<OPNetTransactionTypes>,
    ): TransactionReceiptResult {
        if (data.OPNetType !== OPNetTransactionTypes.Interaction) {
            return this.buildEmptyReceipt();
        }

        const interaction: InteractionTransactionDocument = data as InteractionTransactionDocument;

        return {
            receipt: interaction.receipt?.toString('base64') ?? null,
            receiptProofs: interaction.receiptProofs || [],
            events: interaction.events,
            revert: interaction.revert ? interaction.revert.toString('base64') : undefined,
        };
    }

    private buildEmptyReceipt(): TransactionReceiptResultAPI {
        return {
            receipt: null,
            receiptProofs: [],
            events: [],
        };
    }

    private getDecodedParams(params: TransactionReceiptsParams): [string] {
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
