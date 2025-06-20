import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByIdParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByIdParams.js';
import { Schema } from '../../../../protobuf/Schema.js';
import { Route } from '../../../Route.js';

export class ProtobufSchema extends Route<
    Routes.PROTOBUF_SCHEMA,
    JSONRpcMethods,
    string | undefined
> {
    constructor() {
        super(Routes.PROTOBUF_SCHEMA, RouteType.GET);
    }

    public getData(): string | undefined {
        return Schema.schema || undefined;
    }

    public getDataRPC(_params: BlockByIdParams): object | undefined {
        throw new Error('Method not implemented.');
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/protobuf/schema
     * @tag Websocket
     * @summary Get the protocol schema
     * @description Get the protocol schema for the OPNet packets and messages in protobuf format.
     * @response 200 - Return the protocol schema
     * @response 404 - Schema not found
     * @response 500 - Something went wrong
     * @security BearerAuth
     * @response default - Unexpected error
     * @responseContent {string} 200.plain/text
     */
    protected onRequest(_req: Request, res: Response, _next?: MiddlewareNext): undefined {
        const response: string | undefined = this.getData();

        if (response === null || !response) {
            res.status(404);
            res.send('No schema found');
        } else {
            res.send(response);
        }
    }
}
