import { Address } from '@btc-vision/bsi-binary';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { ContractInformation } from '../../../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { GetCodeParams } from '../../../../json-rpc/types/interfaces/params/states/GetCodeParams.js';
import { GetCodeResult } from '../../../../json-rpc/types/interfaces/results/states/GetCodeResult.js';
import { Route } from '../../../Route.js';

export class GetCode extends Route<
    Routes.GET_CODE,
    JSONRpcMethods.GET_CODE,
    GetCodeResult | undefined
> {
    constructor() {
        super(Routes.GET_CODE, RouteType.GET);
    }

    public async getData(params: GetCodeParams): Promise<GetCodeResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [address, onlyBytecode, isVirtual] = this.getDecodedParams(params);

        let contract: ContractInformation | undefined;
        if (isVirtual) {
            contract = await this.storage.getContractAtVirtualAddress(address);
        } else {
            contract = await this.storage.getContractAt(address);
        }

        if (!contract) return;

        let result: GetCodeResult;
        if (onlyBytecode) {
            result = {
                bytecode: contract.bytecode.toString('base64'),
            };
        } else {
            const document = contract.toDocument();

            result = {
                contractAddress: document.contractAddress.toString(),
                virtualAddress: document.virtualAddress.toString(),

                contractSeed: document.contractSeed.toString('base64'),
                contractSaltHash: document.contractSaltHash.toString('hex'),

                deployedTransactionId: document.deployedTransactionId,
                deployedTransactionHash: document.deployedTransactionHash,
                deployerPubKey: document.deployerPubKey.toString('base64'),
                deployerAddress: document.deployerAddress,

                bytecode: contract.bytecode.toString('base64'),

                wasCompressed: document.wasCompressed,
            };
        }

        return result;
    }

    public async getDataRPC(params: GetCodeParams): Promise<GetCodeResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Contract bytecode not found at the specified address.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/states/get-code
     * @tag States
     * @summary Get a contract information by address
     * @description Get the bytecode of the given contract address with all it's descriptors.
     * @queryParam {string} address - The address of the contract.
     * @queryParam {boolean} [onlyBytecode] - If true, only the bytecode will be returned.
     * @response 200 - Return the bytecode of the contract and all it's descriptors.
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
                res.json({ error: 'Could not fetch latest block header. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): GetCodeParams | undefined {
        if (!req.query) {
            throw new Error('Invalid params.');
        }

        const address = req.query.address as string;

        if (!address || address.length < 50) {
            res.status(400);
            res.json({ error: 'Invalid address.' });
            return;
        }

        const onlyBytecode = (req.query.onlyBytecode as string | undefined) === 'true';
        return {
            address,
            onlyBytecode,
        };
    }

    private getDecodedParams(params: GetCodeParams): [Address, boolean, boolean] {
        let address: Address | undefined;
        let onlyBytecode: boolean;

        if (Array.isArray(params)) {
            address = params.shift() as Address | undefined;

            onlyBytecode = (params.shift() as boolean | undefined) ?? false;
        } else {
            address = params.address;

            onlyBytecode = params.onlyBytecode ?? false;
        }

        if (!address || address.length < 50) throw new Error(`Invalid address specified.`);

        const startsWith = address.startsWith('0x');
        return [address, onlyBytecode, startsWith];
    }
}
