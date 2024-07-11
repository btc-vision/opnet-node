import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import {
    GenerateParams,
    GenerateParamsAsArray,
    GenerateParamsAsObject,
    GenerateTarget,
} from '../../../../json-rpc/types/interfaces/params/opnet/GenerateParams.js';
import {
    GeneratedResult,
    UnwrappedGenerationResult,
    WrappedGenerationResult,
} from '../../../../json-rpc/types/interfaces/results/opnet/GenerateResult.js';
import {
    WrapTransactionGenerator,
    WrapTransactionParameters,
} from '../../../../../blockchain-indexer/processor/transaction/generator/WrapTransactionGenerator.js';
import { Config } from '../../../../../config/Config.js';
import { UnwrapGenerator } from '../../../../../blockchain-indexer/processor/transaction/generator/UnwrapGenerator.js';
import { ABICoder, Address, BinaryReader, BinaryWriter } from '@btc-vision/bsi-binary';
import { AddressVerificator } from '@btc-vision/transaction';
import { NetworkConverter } from '../../../../../config/NetworkConverter.js';
import { Network } from 'bitcoinjs-lib';
import { TrustedAuthority } from '../../../../../poa/configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../../../../poa/configurations/manager/AuthorityManager.js';
import { Call } from '../states/Call.js';
import { CallRequestResponse } from '../../../../../threading/interfaces/thread-messages/messages/api/CallRequest.js';

const abiCoder = new ABICoder();

export class GenerateRoute extends Route<
    Routes.GENERATE,
    JSONRpcMethods.GENERATE,
    GeneratedResult<GenerateTarget> | undefined
> {
    private static WITHDRAWABLE_BALANCE_OF: number = Number(
        '0x' + abiCoder.encodeSelector('withdrawableBalanceOf'),
    );

    private readonly network: Network = NetworkConverter.getNetwork(
        Config.BLOCKCHAIN.BITCOIND_NETWORK,
    );

    private readonly wrapTransactionGenerator: WrapTransactionGenerator =
        new WrapTransactionGenerator(this.network);

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();

    private unwrapGenerator: UnwrapGenerator | undefined;
    private readonly MINIMUM_AMOUNT: bigint = 330n;

    constructor() {
        super(Routes.GENERATE, RouteType.GET);
    }

    public async getData(
        params: GenerateParams,
    ): Promise<GeneratedResult<GenerateTarget> | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        if (!params) {
            throw new Error('No params provided.');
        }

        const decodedParams = this.getDecodedParams(params);
        try {
            if (typeof decodedParams[1] === 'string') decodedParams[1] = BigInt(decodedParams[1]);
        } catch (e) {
            throw new Error('Invalid amount.');
        }

        const [target, amount, receiver] = decodedParams;
        if (GenerateTarget[target as GenerateTarget] === undefined) {
            throw new Error('Invalid target.');
        }

        switch (target) {
            case GenerateTarget.WRAP:
                return await this.onGenerateWrap(amount);
            case GenerateTarget.UNWRAP:
                return await this.generateUnwrapParameters(BigInt(amount), receiver);
            default:
                throw new Error('Invalid target.');
        }
    }

    public async getDataRPC(
        params: GenerateParams,
    ): Promise<GeneratedResult<GenerateTarget> | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not generate transaction`);

        return data;
    }

    protected initialize(): void {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        this.unwrapGenerator = new UnwrapGenerator(this.storage);
    }

    /**
     * GET /api/v1/opnet/generate
     * @tag OPNet
     * @summary Generate an opnet transaction with the given parameters
     * @description Generate an opnet transaction with the given parameters
     * @queryParam {number} target - The target (0: wrap)
     * @queryParam {number} amount - The amount in satoshis
     * @response 200 - Returns the generated transaction
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            req.body = req.query; //await req.json();

            const params = this.getParams(req, res);
            if (!params) {
                throw new Error('No params provided.');
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

    protected getParams(req: Request, res: Response): GenerateParamsAsObject | undefined {
        if (!req.body) {
            throw new Error('Params not provided.');
        }

        const amount: string | bigint = req.body.amount;
        const target: GenerateTarget = req.body.target;
        const receiver: Address | undefined = req.body.receiver;

        if (!req.body || !amount) {
            res.status(400);
            res.json({ error: 'Invalid request, amount not specified.' });
            return;
        }

        return {
            target: target,
            amount: amount,
            receiver: receiver,
        };
    }

    private generateGetBalanceCalldata(receiver: Address): string {
        const writer = new BinaryWriter();
        writer.writeSelector(GenerateRoute.WITHDRAWABLE_BALANCE_OF);
        writer.writeAddress(receiver);
        1;
        return Buffer.from(writer.getBuffer()).toString('hex');
    }

    private decodeBalanceOfResult(result: Uint8Array): bigint {
        const reader: BinaryReader = new BinaryReader(result);

        return reader.readU256();
    }

    private async generateUnwrapParameters(
        amount: bigint,
        receiver: Address | undefined,
    ): Promise<UnwrappedGenerationResult | undefined> {
        if (!this.unwrapGenerator) {
            throw new Error('Unwrap generator not initialized');
        }

        if (!receiver || !AddressVerificator.isValidP2TRAddress(receiver, this.network)) {
            throw new Error('Invalid receiver address. Address must be p2tr.');
        }

        if (amount < this.MINIMUM_AMOUNT) {
            throw new Error(`Amount must be at least ${this.MINIMUM_AMOUNT} sat.`);
        }

        const balanceOfCalldata: string = this.generateGetBalanceCalldata(receiver);
        const balanceOfResult: CallRequestResponse = await Call.requestThreadExecution(
            this.currentAuthority.WBTC_SEGWIT_CONTRACT_ADDRESS,
            balanceOfCalldata,
            receiver,
        );

        if ('error' in balanceOfResult) {
            throw new Error(balanceOfResult.error);
        }

        if (!balanceOfResult.result) {
            throw new Error('No result returned');
        }

        const currentWBTCBalance: bigint = this.decodeBalanceOfResult(balanceOfResult.result);
        const generated: UnwrappedGenerationResult | undefined =
            await this.unwrapGenerator.generateUnwrapParameters(amount, currentWBTCBalance);

        if (!generated) throw new Error('Failed to generate unwrap transaction');

        return generated;
    }

    private async onGenerateWrap(amount: bigint): Promise<WrappedGenerationResult | undefined> {
        if (amount < this.MINIMUM_AMOUNT) {
            throw new Error(`Amount must be at least ${this.MINIMUM_AMOUNT} sat.`);
        }

        const params: WrapTransactionParameters = {
            amount: amount,
        };

        const generated: WrappedGenerationResult | undefined =
            await this.wrapTransactionGenerator.generateWrapParameters(params);

        if (!generated) throw new Error('Failed to generate wrap transaction');

        return generated;
    }

    private getDecodedParams(params: GenerateParams): GenerateParamsAsArray {
        let amount: bigint | string;
        let target: GenerateTarget;
        let receiver: Address | undefined;

        if (Array.isArray(params)) {
            target = parseInt(params[0] as string) as GenerateTarget;
            amount = params[1];
            receiver = params[2];
        } else {
            target = parseInt(params.target as string) as GenerateTarget;
            amount = params.amount;
            receiver = params.receiver;
        }

        return [target, amount, receiver];
    }
}
