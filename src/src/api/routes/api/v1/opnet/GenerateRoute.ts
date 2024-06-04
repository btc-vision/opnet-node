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
import { GeneratedResult } from '../../../../json-rpc/types/interfaces/results/opnet/GenerateResult.js';
import {
    WrapTransactionGenerator,
    WrapTransactionParameters,
} from '../../../../../blockchain-indexer/processor/transaction/generator/WrapTransactionGenerator.js';

export class GenerateRoute extends Route<
    Routes.GENERATE,
    JSONRpcMethods.GENERATE,
    GeneratedResult | undefined
> {
    private readonly wrapTransactionGenerator: WrapTransactionGenerator =
        new WrapTransactionGenerator();
    private readonly MINIMUM_AMOUNT_WRAP: bigint = 330n;

    constructor() {
        super(Routes.GENERATE, RouteType.POST);
    }

    public async getData(params: GenerateParams): Promise<GeneratedResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const decodedParams = this.getDecodedParams(params);
        try {
            if (typeof decodedParams[1] === 'string') decodedParams[1] = BigInt(decodedParams[1]);
        } catch (e) {
            throw new Error('Invalid amount.');
        }

        const [target, amount] = decodedParams;
        if (GenerateTarget[target] === undefined) {
            throw new Error('Invalid target.');
        }

        switch (target) {
            case GenerateTarget.WRAP:
                return await this.onGenerateWrap(amount);
            default:
                throw new Error('Invalid target.');
        }
    }

    public async getDataRPC(params: GenerateParams): Promise<GeneratedResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Failed to generate transaction`);

        return data;
    }

    protected initialize(): void {}

    /**
     * POST /api/v1/opnet/generate
     * @tag OPNet
     * @summary Generate an opnet transaction with the given parameters
     * @description Generate an opnet transaction with the given parameters
     * @response 200 - Returns the generated transaction
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
                res.json({ error: 'Could not fetch latest block header. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): GenerateParamsAsObject | undefined {
        const amount: string | bigint = req.body.amount;
        const target: GenerateTarget = req.body.target;

        if (!req.body || !amount) {
            res.status(400);
            res.json({ error: 'Invalid request, amount not specified.' });
            return;
        }

        return {
            target: target,
            amount: amount,
        };
    }

    private async onGenerateWrap(amount: bigint): Promise<GeneratedResult | undefined> {
        this.log(`Generating wrap transaction with amount: ${amount}`);

        if (amount < this.MINIMUM_AMOUNT_WRAP) {
            throw new Error(`Amount must be at least ${this.MINIMUM_AMOUNT_WRAP} sat.`);
        }

        const params: WrapTransactionParameters = {
            amount: amount,
        };

        const generated: string | undefined =
            await this.wrapTransactionGenerator.generateWrapTransaction(params);
        if (!generated) throw new Error('Failed to generate wrap transaction');

        return {
            generatedTransaction: generated,
        };
    }

    private getDecodedParams(params: GenerateParams): GenerateParamsAsArray {
        let amount: bigint | string;
        let target: GenerateTarget;

        if (Array.isArray(params)) {
            target = params[0];
            amount = params[1];
        } else {
            target = params.target;
            amount = params.amount;
        }

        return [target, amount];
    }
}
