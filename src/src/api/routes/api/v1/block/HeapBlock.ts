import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { MessageType } from '../../../../../threading/enum/MessageType.js';
import { GetBlock } from '../../../../../threading/interfaces/thread-messages/messages/api/GetBlock.js';
import { RPCMessage } from '../../../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';

import { ThreadTypes } from '../../../../../threading/thread/enums/ThreadTypes.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { ServerThread } from '../../../../ServerThread.js';
import { Route } from '../../../Route.js';

export class HeapBlockRoute extends Route<Routes.HEAP_BLOCK> {
    constructor() {
        super(Routes.HEAP_BLOCK, RouteType.GET);
    }

    protected initialize(): void {
        /*SharedSubscriptionManager.subscribe(
            SubscriptionType.NEW_BLOCK,
            (blockData: NewBlockSubscription) => {
                this.onNewBlock(blockData);
            },
        );*/
    }

    /**
     * GET /api/v1/block/heapBlock
     * @tag MotoSwap
     * @summary Get the current heap block of MotoSwap
     * @description Get the current heap block of MotoSwap (the block that is currently being processed)
     * @response 200 - Return the current heap block of the Bitcoin blockchain.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {HeapBlock} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK> = {
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
        }
    }
}
