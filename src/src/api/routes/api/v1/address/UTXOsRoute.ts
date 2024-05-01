import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { UTXOsByAddressParams } from '../../../../json-rpc/types/interfaces/params/UTXOsByAddressParams.js';
import { UTXOsOutputResult } from '../../../../json-rpc/types/interfaces/results/UTXOsOutputResult.js';
import { UTXOsOutputTransactions } from '../../../../json-rpc/types/interfaces/results/UTXOsOutputTransactions.js';
import { Route } from '../../../Route.js';
import { SafeString } from '../../../safe/SafeMath.js';

export class UTXOsRoute extends Route<
    Routes.UTXOS,
    JSONRpcMethods.GET_UTXOS,
    UTXOsOutputTransactions | undefined
> {
    constructor() {
        super(Routes.UTXOS, RouteType.GET);
    }

    public async getData(
        params: UTXOsByAddressParams,
    ): Promise<UTXOsOutputTransactions | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const address: SafeString = this.getParameterAsStringForUTXOs(params);
        if (!address) {
            throw new Error('Address not provided');
        }

        const optimize: boolean = this.getOptimizeParameterAsBoolean(params);

        return await this.storage.getUTXOs(address, optimize);
    }

    public async getDataRPC(params: UTXOsByAddressParams): Promise<UTXOsOutputResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not fetch UTXOs for the given address.`);

        return data;
    }

    protected initialize(): void {}

    // TODO: Add the response type to the @response tag
    /**
     * GET /api/v1/address/utxos
     * @tag OpNet
     * @summary Get the requested wallet unspent transaction outputs (UTXOs).
     * @description Get every unspent transaction output (UTXO) for the requested wallet. This endpoint allows also UTXOs optimization for dust UTXOs.
     * @response 200 - Returns the requested wallet UTXOs.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const address = req.query.address as string | undefined;
            if (!address) {
                res.status(400);
                res.json({ error: `Address was not provided.` });
                return;
            }

            const optimize = req.query.optimize as boolean | undefined;
            const data = await this.getData({
                address: address,
                optimize: optimize,
            });

            if (data) {
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: 'Could not fetch UTXOs for the given address.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private getOptimizeParameterAsBoolean(params: UTXOsByAddressParams): boolean {
        const isArray = Array.isArray(params);

        let includeTransactions;
        if (isArray) {
            includeTransactions = params.shift();

            if (typeof includeTransactions !== 'boolean') {
                includeTransactions = false;
            }
        } else {
            includeTransactions = params.optimize ?? false;
        }

        return includeTransactions;
    }

    private getParameterAsStringForUTXOs(params: UTXOsByAddressParams): SafeString {
        const isArray = Array.isArray(params);

        let blockHash;
        if (isArray) {
            blockHash = params.shift();

            if (typeof blockHash !== 'string') {
                blockHash = null;
            }
        } else {
            blockHash = params.address;
        }

        return blockHash;
    }
}
