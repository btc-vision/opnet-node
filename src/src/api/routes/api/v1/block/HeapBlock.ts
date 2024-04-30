import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByIdParams } from '../../../../json-rpc/types/interfaces/params/BlockByIdParams.js';
import { BlockHeadersById } from '../../../../json-rpc/types/interfaces/params/BlockHeadersById.js';
import { BlockHeadersByIdResult } from '../../../../json-rpc/types/interfaces/results/BlockHeadersByIdResult.js';
import { Route } from '../../../Route.js';
import { SafeMath } from '../../../safe/SafeMath.js';

export class HeapBlockRoute extends Route<
    Routes.HEAP_BLOCK,
    JSONRpcMethods.BLOCK_HEIGHT_BY_ID,
    BlockHeadersByIdResult | undefined
> {
    constructor() {
        super(Routes.HEAP_BLOCK, RouteType.GET);
    }

    public async getData(
        _params: BlockHeadersById,
    ): Promise<BlockHeaderAPIBlockDocument | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const height = SafeMath.getParameterAsBigInt(_params);

        return this.storage.getLatestBlock();
    }

    public async getDataRPC(params: BlockByIdParams): Promise<BlockHeadersByIdResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/block/heapBlock
     * @tag OpNet
     * @summary Get the current heap block of OpNet
     * @description Get the current heap block of OpNet (the block that is currently being processed)
     * @response 200 - Return the current heap block of the Bitcoin blockchain.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {HeapBlock} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        /*const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK,
            } as GetBlock,
        };

        const currentBlock = await ServerThread.sendMessageToThread(
            ThreadTypes.BITCOIN_RPC,
            currentBlockMsg,
        );

        try {
            if (!currentBlock) {
                res.status(400);
                res.json({ error: 'Something went wrong.' });
            } else {
                res.status(200);
                res.json(currentBlock);
            }
        } catch (err: unknown) {
            let e = err as Error;
            this.error(e.stack);

            res.status(500);
            res.end();
        }*/

        try {
            const height = _req.query.height as string | undefined;
            const bigintHeight = height ? BigInt(height) : -1;

            const data = await this.getData({ height: bigintHeight });

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
}
