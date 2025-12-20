import { DataConverter } from '@btc-vision/bsi-common';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { EventReceiptDataForAPI } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import {
    InteractionTransactionDocument,
    ITransactionDocument,
    NetEventDocument,
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

    public async getData(params: TransactionReceiptsParams): Promise<TransactionReceiptResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [hash] = this.getDecodedParams(params);
        if (hash.length !== 64) throw new Error(`Invalid hash length: ${hash.length}`);

        const data = await this.storage.getTransactionByHash(hash);
        if (!data) {
            throw new Error(`Could not find the transaction ${hash}.`);
        }

        return this.getReceipt(data);
    }

    public async getDataRPC(
        params: TransactionReceiptsParams,
    ): Promise<TransactionReceiptResult | undefined> {
        return await this.getData(params);
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
            if (!params) {
                return; // getParams already sent error response
            }

            const data = await this.getData(params);
            this.safeJson(res, 200, data);
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): TransactionReceiptsParams | undefined {
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

    private getReceipt(
        data: ITransactionDocument<OPNetTransactionTypes>,
    ): TransactionReceiptResult {
        if (data.OPNetType !== OPNetTransactionTypes.Interaction) {
            return this.buildEmptyReceipt();
        }

        const interaction: InteractionTransactionDocument = data as InteractionTransactionDocument;
        const gasUsed: bigint = interaction.gasUsed
            ? DataConverter.fromDecimal128(interaction.gasUsed)
            : 0n;

        const specialGasUsed: bigint = interaction.specialGasUsed
            ? DataConverter.fromDecimal128(interaction.specialGasUsed)
            : 0n;

        return {
            receipt: interaction.receipt?.toString('base64') ?? null,
            receiptProofs: interaction.receiptProofs || [],
            events: this.restoreEvents(interaction.events),
            revert: interaction.revert ? interaction.revert.toString('base64') : undefined,
            gasUsed: '0x' + gasUsed.toString(16),
            specialGasUsed: '0x' + specialGasUsed.toString(16),
        };
    }

    private restoreEvents(events: NetEventDocument[]): EventReceiptDataForAPI[] {
        return events.map((event: NetEventDocument): EventReceiptDataForAPI => {
            return {
                contractAddress: '0x' + event.contractAddress.toString('hex'),
                type: event.type.toString('utf8'),
                data: event.data.toString('base64'),
            };
        });
    }

    private buildEmptyReceipt(): TransactionReceiptResultAPI {
        return {
            receipt: null,
            receiptProofs: [],
            events: [],
            gasUsed: '0x0',
            specialGasUsed: '0x0',
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
