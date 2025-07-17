import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { EpochTemplateParams } from '../../../../json-rpc/types/interfaces/params/epochs/EpochTemplateParams.js';
import { EpochTemplateResult } from '../../../../json-rpc/types/interfaces/results/epochs/EpochTemplateResult.js';

export class GetEpochTemplate extends Route<
    Routes.GET_EPOCH_TEMPLATE,
    JSONRpcMethods.GET_EPOCH_TEMPLATE,
    EpochTemplateResult
> {
    constructor() {
        super(Routes.GET_EPOCH_TEMPLATE, RouteType.GET);
    }

    public async getData(params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        throw new Error('Get epoch template not implemented');
    }

    public async getDataRPC(params?: EpochTemplateParams): Promise<EpochTemplateResult> {
        throw new Error('Get epoch template not implemented');
    }

    protected initialize(): void {
        // Initialize any required resources
    }

    /**
     * GET /api/v1/epoch/template
     * @tag Epoch
     * @summary Get a template for epoch mining.
     * @description Get the current epoch mining template with target hash and requirements.
     * @response 200 - Return the epoch template.
     * @response 400 - Something went wrong.
     * @response 501 - Not implemented.
     * @response default - Unexpected error
     * @responseContent {EpochTemplateResult} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            // For now, return not implemented
            res.status(501);
            res.json({
                error: 'Get epoch template not implemented',
                code: 'NOT_IMPLEMENTED',
            });
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }
}
