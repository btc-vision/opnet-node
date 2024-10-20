import { BufferHelper } from '@btc-vision/transaction';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Binary } from 'mongodb';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { GetStorageAtParams } from '../../../../json-rpc/types/interfaces/params/states/GetStorageAtParams.js';
import { GetStorageAtResult } from '../../../../json-rpc/types/interfaces/results/states/GetStorageAtResult.js';
import { Route } from '../../../Route.js';

export class GetStorageAt extends Route<
    Routes.GET_STORAGE_AT,
    JSONRpcMethods.GET_STORAGE_AT,
    GetStorageAtResult | undefined
> {
    constructor() {
        super(Routes.GET_STORAGE_AT, RouteType.GET);
    }

    public async getData(params: GetStorageAtParams): Promise<GetStorageAtResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [address, pointer, sendProofs, height] = this.getDecodedParams(params);
        const pointerAsUint8Array = BufferHelper.bufferToUint8Array(pointer.buffer);

        const data = await this.storage.getStorage(
            address,
            pointerAsUint8Array,
            null,
            false,
            height,
        );

        if (!data) return;

        return {
            pointer: pointer.toString('base64'),
            value: new Binary(data.value).toString('base64'),
            height: data.lastSeenAt.toString(),
            proofs: sendProofs ? data.proofs : [],
        };
    }

    public async getDataRPC(params: GetStorageAtParams): Promise<GetStorageAtResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Requested data not found.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/states/get-storage-at
     * @tag States
     * @summary Get the storage at a specific address and pointer.
     * @description Get the storage at a specific address and pointer.
     * @queryParam {string} address - The address to get the storage from.
     * @queryParam {string} pointer - The pointer to get the storage from.
     * @queryParam {boolean} [sendProofs] - Whether to send proofs or not.
     * @queryParam {string} [height] - The height to get the storage from.
     * @response 200 - Return the storage value and proofs at the given address and pointer.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const params = this.getParams(req, res);
            if (!params) {
                throw new Error('Invalid params.');
            }

            const data = await this.getData(params);

            if (data) {
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: `Requested data not found.` });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): GetStorageAtParams | undefined {
        if (!req.query) {
            throw new Error('Invalid params.');
        }

        const address = req.query.address as string;

        if (!address || (address && address.length !== 64)) {
            res.status(400);
            res.json({ error: 'Invalid hash.' });
            return;
        }

        const pointer = req.query.pointer as string;
        if (!pointer) {
            res.status(400);
            res.json({ error: 'Invalid pointer.' });
            return;
        }

        const sendProofs = (req.query.sendProofs as string | undefined) === 'true';
        const height = req.query.height as string | undefined;

        if (height) {
            if (isNaN(parseInt(height))) {
                res.status(400);
                res.json({ error: 'Invalid height.' });
                return;
            }
        }

        return {
            address,
            pointer,
            sendProofs,
            height,
        };
    }

    private getDecodedParams(
        params: GetStorageAtParams,
    ): [string, Binary, boolean, bigint | undefined] {
        let address: string | undefined;
        let pointer: string | undefined;
        let sendProofs: boolean | undefined;
        let height: bigint | undefined;

        if (Array.isArray(params)) {
            address = params.shift() as string | undefined;

            if (!address) {
                throw new Error('Invalid address.');
            }

            pointer = params.shift() as string | undefined;

            if (!pointer) {
                throw new Error('Invalid pointer.');
            }

            sendProofs = params.shift() as boolean | undefined;

            const _height = params.shift();
            if (_height) {
                height = BigInt(_height) + 1n;
            }
        } else {
            address = params.address;
            pointer = params.pointer;
            sendProofs = params.sendProofs;

            if (params.height) height = BigInt(params.height);
        }

        if (!address || address.length < 20) throw new Error(`Invalid address specified.`);

        return [address, Binary.createFromBase64(pointer), sendProofs ?? true, height || undefined];
    }
}
