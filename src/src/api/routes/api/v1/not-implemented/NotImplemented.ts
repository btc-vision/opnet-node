import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByIdParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByIdParams.js';
import { Route } from '../../../Route.js';

export class NotImplemented extends Route<
    Routes.NOT_IMPLEMENTED,
    JSONRpcMethods,
    string | undefined
> {
    constructor() {
        super(Routes.NOT_IMPLEMENTED, RouteType.GET);
    }

    public getData(): string | undefined {
        return 'Not Implemented';
    }

    public getDataRPC(_params: BlockByIdParams): { error: string } | undefined {
        return {
            error: 'Not Implemented',
        };
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/not-implemented
     * @tag OP_NET
     * @summary Not implemented fallback
     * @description This endpoint is a fallback for not implemented endpoints
     * @response 200 - Not Implemented
     * @response 400 - Not Implemented
     * @response default - Unexpected error
     * @responseContent {error: string} 200.plain/text
     */
    protected onRequest(_req: Request, res: Response, _next?: MiddlewareNext): undefined {
        const response: string | undefined = this.getData();

        res.status(400);
        res.json(response);
    }
}
