import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { GetBalanceParams } from '../../../../json-rpc/types/interfaces/params/address/GetBalanceParams.js';
import { GetBalanceResult } from '../../../../json-rpc/types/interfaces/results/address/GetBalanceResult.js';
import { Route } from '../../../Route.js';
import { SafeString } from '../../../safe/BlockParamsConverter.js';

export class GetBalanceRoute extends Route<
    Routes.GET_BALANCE,
    JSONRpcMethods.GET_BALANCE,
    GetBalanceResult
> {
    constructor() {
        super(Routes.GET_BALANCE, RouteType.GET);
    }

    public async getData(params: GetBalanceParams): Promise<GetBalanceResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const address: SafeString = this.getParameterAsStringForBalance(params);
        if (!address) {
            throw new Error('Address not provided');
        }

        const filterOrdinals: boolean = this.getFilterOrdinals(params);

        const balanceOf: bigint = (await this.storage.getBalanceOf(address, filterOrdinals)) || 0n;
        return `0x${balanceOf.toString(16)}`;
    }

    public async getDataRPC(params: GetBalanceParams): Promise<GetBalanceResult> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not fetch balance for the given address.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/address/get-balance
     * @tag Address
     * @summary Get the requested wallet current btc balance.
     * @description Get the current btc balance for the requested wallet.
     * @queryParam {string} [address] - The address of the wallet to fetch.
     * @queryParam {boolean} [filterOrdinals] - Filter ordinals. If true, the ordinals will be filtered.
     * @response 200 - Returns the requested wallet balance.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {string} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            if (!req.query) {
                throw new Error('Invalid params.');
            }

            const address = req.query.address as string | undefined;
            if (!address) {
                res.status(400);
                res.json({ error: 'Address not provided' });
                return;
            }

            const data = await this.getData({
                address: address,
            });

            if (data) {
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: 'Could not fetch balance for the given address.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private getParameterAsStringForBalance(params: GetBalanceParams): SafeString {
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

    private getFilterOrdinals(params: GetBalanceParams): boolean {
        const isArray = Array.isArray(params);

        let filterOrdinals: boolean;
        if (isArray) {
            filterOrdinals = (params.shift() as boolean) ?? false;
        } else {
            filterOrdinals = params.filterOrdinals ?? false;
        }

        return filterOrdinals;
    }
}
