import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { UTXOsByAddressParams } from '../../../../json-rpc/types/interfaces/params/address/UTXOsByAddressParams.js';
import { UTXOsOutputResult } from '../../../../json-rpc/types/interfaces/results/address/UTXOsOutputResult.js';
import { UTXOsOutputTransactions } from '../../../../json-rpc/types/interfaces/results/address/UTXOsOutputTransactions.js';
import { Route } from '../../../Route.js';
import { SafeString } from '../../../safe/BlockParamsConverter.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';

export class UTXOsRoute extends Route<
    Routes.UTXOS,
    JSONRpcMethods.GET_UTXOS,
    UTXOsOutputTransactions | undefined
> {
    private currentBlockHeight: bigint = 0n;

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
        const olderThan: bigint | undefined = this.getOlderThanParameterAsNumber(params);

        const targetBlockHeight =
            olderThan !== undefined ? this.currentBlockHeight - olderThan : undefined;

        return await this.storage.getUTXOs(address, optimize, targetBlockHeight);
    }

    public onBlockChange(_blockNumber: bigint, _blockHeader: BlockHeaderAPIBlockDocument) {
        this.currentBlockHeight = _blockNumber;
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
     * @tag Address
     * @summary Get the requested wallet unspent transaction outputs (UTXOs).
     * @description Get every unspent transaction output (UTXOs) for the requested wallet. This endpoint allows also UTXOs optimization for dust UTXOs.
     * @queryParam {string} [address] - The address of the wallet to fetch.
     * @queryParam {boolean} [optimize] - Optimize the UTXOs for the given address.
     * @response 200 - Returns the requested wallet UTXOs.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            if (!req.query) {
                throw new Error('Invalid params.');
            }

            const address = req.query.address as string | undefined;
            if (!address) {
                this.safeJson(res, 400, { error: `Address was not provided.` });
                return;
            }

            const optimize = req.query.optimize as boolean | undefined;
            const data = await this.getData({
                address: address,
                optimize: optimize,
            });

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch UTXOs for the given address.' });
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
            includeTransactions = params.optimize === 'true';
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

    private getOlderThanParameterAsNumber(params: UTXOsByAddressParams): bigint | undefined {
        const isArray = Array.isArray(params);

        let olderThan;
        if (isArray) {
            const param = params.shift();
            if (typeof param === 'string') {
                olderThan = BigInt(param);
            }
        } else {
            olderThan = params.olderThan ? BigInt(params.olderThan) : undefined;
        }

        return olderThan;
    }
}
