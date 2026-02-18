import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { PublicKeyInfoResult } from '../../../../json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';
import {
    PublicKeyInfoAsObject,
    PublicKeyInfoParams,
} from '../../../../json-rpc/types/interfaces/params/address/PublicKeyInfoParams.js';
import { AddressVerificator } from '@btc-vision/transaction';

export class PublicKeyInfoRoute extends Route<
    Routes.PUBLIC_KEY_INFO,
    JSONRpcMethods.PUBLIC_KEY_INFO,
    PublicKeyInfoResult
> {
    public constructor() {
        super(Routes.PUBLIC_KEY_INFO, RouteType.POST);
    }

    public async getData(params: PublicKeyInfoParams): Promise<PublicKeyInfoResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        try {
            const parameters = this.parseParameters(params);

            return await this.storage.getAddressOrPublicKeysInformation(parameters);
        } catch (e) {
            throw new Error(
                `Something went wrong while attempting to fetch public key info: ${(e as Error).message}`,
                { cause: e },
            );
        }
    }

    public async getDataRPC(params: PublicKeyInfoParams): Promise<PublicKeyInfoResult> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not fetch public key info for the given address(es).`);

        return data;
    }

    protected initialize(): void {}

    /**
     * POST /api/v1/address/public-key-info
     * @tag Address
     * @summary Get public key info
     * @description Returns the public key info for the given address(es).
     * @bodyContent {PublicKeyInfoParams} application/json
     * @response 200 - Returns the public key info for the given address(es).
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {string} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            req.body = await req.json();

            const body = req.body as PublicKeyInfoParams;
            if (!body) {
                throw new Error('Invalid params.');
            }

            const data = await this.getDataRPC(body);
            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch balance for the given address.' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private verifyObject(params: PublicKeyInfoAsObject): void {
        if (typeof params !== 'object') {
            throw new Error('Invalid address specified.');
        }

        if (!params.address || typeof params.address !== 'string') {
            throw new Error('Invalid address specified.');
        }

        this.verifyAddressConformity(params.address);
    }

    private verifyAddressConformity(address: string): void {
        if (!AddressVerificator.detectAddressType(address, this.network)) {
            throw new Error(`Address ${address} is not a valid Bitcoin address.`);
        }
    }

    private parseParameters(params: PublicKeyInfoParams): string[] {
        const isArray = Array.isArray(params);
        const finalParams: string[] = [];

        if (isArray) {
            if (!params.length) {
                throw new Error('No addresses specified.');
            }

            const addresses = params[0];
            if (addresses.length > 1000) {
                throw new Error('Too many addresses specified. Maximum is 1000.');
            }

            for (let i = 0; i < addresses.length; i++) {
                const address = addresses[i];
                if (typeof address !== 'string' || !address) {
                    throw new Error('Invalid address specified.');
                }

                this.verifyAddressConformity(address);

                finalParams.push(address);
            }
        } else {
            this.verifyObject(params);
            finalParams.push(params.address);
        }

        return finalParams;
    }
}
