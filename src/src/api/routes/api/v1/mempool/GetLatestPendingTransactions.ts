import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Config } from '../../../../../config/Config.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { GetLatestPendingTransactionsParams } from '../../../../json-rpc/types/interfaces/params/mempool/GetLatestPendingTransactionsParams.js';
import { GetLatestPendingTransactionsResult } from '../../../../json-rpc/types/interfaces/results/mempool/GetLatestPendingTransactionsResult.js';
import {
    IPubKeyNotFoundError,
    PublicKeyInfo,
} from '../../../../json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';
import { Route } from '../../../Route.js';
import { MempoolTransactionConverter } from './MempoolTransactionConverter.js';

/**
 * Route handler for fetching the latest pending transactions from the mempool.
 *
 * @remarks
 * Supports optional address-based filtering and pagination via the `limit` parameter.
 * When a single address is supplied, it is auto-resolved to all derived wallet address
 * types (p2tr, p2op, p2pkh, p2wpkh, p2sh-p2wpkh) so the caller does not need to know
 * the full set of addresses associated with a key.
 *
 * Limits are governed by {@link Config.API.MEMPOOL}.
 */
export class GetLatestPendingTransactions extends Route<
    Routes.MEMPOOL_TRANSACTIONS,
    JSONRpcMethods.GET_LATEST_PENDING_TRANSACTIONS,
    GetLatestPendingTransactionsResult
> {
    constructor() {
        super(Routes.MEMPOOL_TRANSACTIONS, RouteType.GET);
    }

    /**
     * Retrieves the latest pending mempool transactions, optionally filtered by address(es).
     *
     * @param params - Optional filter / pagination parameters.
     * @returns The matching pending transactions.
     * @throws If storage is not initialised or the address count exceeds the configured maximum.
     */
    public async getData(
        params?: GetLatestPendingTransactionsParams,
    ): Promise<GetLatestPendingTransactionsResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const decoded = this.getDecodedParams(params);
        let addresses: string[] | undefined = decoded.addresses;
        const limit = Math.max(1, Math.min(decoded.limit, Config.API.MEMPOOL.MAX_LIMIT));

        // If a single address is provided, auto-resolve all address types
        if (decoded.address && !addresses) {
            addresses = await this.resolveAddresses(decoded.address);
        }

        if (addresses && addresses.length > Config.API.MEMPOOL.MAX_ADDRESSES) {
            throw new Error(`Too many addresses. Maximum is ${Config.API.MEMPOOL.MAX_ADDRESSES}.`);
        }

        const txs = await this.storage.getLatestPendingTransactions(addresses, limit);

        return {
            transactions: MempoolTransactionConverter.convertMany(txs),
        };
    }

    /** {@inheritDoc Route.getDataRPC} */
    public async getDataRPC(
        params?: GetLatestPendingTransactionsParams,
    ): Promise<GetLatestPendingTransactionsResult | undefined> {
        return await this.getData(params);
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/mempool/transactions
     * @tag Mempool
     * @summary Get latest pending transactions
     * @description Get the latest pending transactions from the mempool. Optionally filter by address.
     * @queryParam {string} [address] - A single address to auto-resolve all wallet address types.
     * @queryParam {string} [addresses] - Comma-separated list of addresses to filter by.
     * @queryParam {number} [limit] - Maximum number of results (default 25, max 100).
     * @response 200 - Returns the latest pending transactions.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {GetLatestPendingTransactionsResultData} 200.application/json
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
                this.safeJson(res, 400, { error: 'Could not fetch pending transactions.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    /**
     * Extracts query-string parameters from an HTTP request.
     *
     * @param req - The incoming HTTP request.
     * @param _res - The HTTP response (unused).
     * @returns Parsed parameters, or `undefined` when invalid.
     */
    protected getParams(
        req: Request,
        _res: Response,
    ): GetLatestPendingTransactionsParams | undefined {
        const address = req.query.address as string | undefined;
        const addressesStr = req.query.addresses as string | undefined;
        const limitStr = req.query.limit as string | undefined;

        const addresses = addressesStr
            ? addressesStr.split(',').filter((a) => a.length > 0)
            : undefined;
        const parsed = limitStr ? parseInt(limitStr, 10) : undefined;
        const limit = parsed && !isNaN(parsed) ? parsed : undefined;

        return {
            address,
            addresses,
            limit,
        };
    }

    /**
     * Resolves a single address to all known wallet address types via public-key lookup.
     *
     * @param address - The address to resolve.
     * @returns Deduplicated array of all derived addresses (including the original).
     */
    private async resolveAddresses(address: string): Promise<string[]> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const result = await this.storage.getAddressOrPublicKeysInformation([address]);
        const allAddresses: string[] = [address];

        for (const key of Object.keys(result)) {
            const pubKeyInfo = result[key];
            if (this.isPubKeyNotFoundError(pubKeyInfo)) {
                continue;
            }

            if (pubKeyInfo.p2tr) allAddresses.push(pubKeyInfo.p2tr);
            if (pubKeyInfo.p2op) allAddresses.push(pubKeyInfo.p2op);
            if (pubKeyInfo.p2pkh) allAddresses.push(pubKeyInfo.p2pkh);
            if (pubKeyInfo.p2wpkh) allAddresses.push(pubKeyInfo.p2wpkh);
            if (pubKeyInfo.p2shp2wpkh) allAddresses.push(pubKeyInfo.p2shp2wpkh);
        }

        // Deduplicate
        return [...new Set(allAddresses)];
    }

    /** Type-guard that narrows a public-key result to the error variant. */
    private isPubKeyNotFoundError(
        info: PublicKeyInfo | IPubKeyNotFoundError,
    ): info is IPubKeyNotFoundError {
        return 'error' in info;
    }

    /**
     * Normalizes both array-style and object-style RPC parameters into a uniform shape.
     *
     * @param params - Raw RPC parameters (array or object form).
     * @returns Normalised parameter object with a guaranteed `limit` value.
     */
    private getDecodedParams(params?: GetLatestPendingTransactionsParams): {
        address?: string;
        addresses?: string[];
        limit: number;
    } {
        if (!params) {
            return { limit: Config.API.MEMPOOL.DEFAULT_LIMIT };
        }

        if (Array.isArray(params)) {
            return {
                address: params[0] ?? undefined,
                addresses: params[1] ?? undefined,
                limit: params[2] ?? Config.API.MEMPOOL.DEFAULT_LIMIT,
            };
        }

        return {
            address: params.address,
            addresses: params.addresses,
            limit: params.limit ?? Config.API.MEMPOOL.DEFAULT_LIMIT,
        };
    }
}
