import { IHttpRequest, IHttpResponse } from 'nanoexpress';
import { SubscriptionType } from '../../blockchain-indexer/shared/enums/Subscriptions.js';
import { NewBlockSubscription } from '../../blockchain-indexer/shared/interfaces/NewBlockSubscription.js';
import { SharedSubscriptionManager } from '../../blockchain-indexer/shared/subscription/SharedSubscriptionManager.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { GetCurrentBlockMessage } from '../../threading/interfaces/thread-messages/messages/api/GetCurrentBlock.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { Routes, RouteType } from '../enums/Routes.js';
import { ServerThread } from '../ServerThread.js';
import { Route } from './Route.js';

export class HeapBlockRoute extends Route<Routes.HEAP_BLOCK> {
    constructor() {
        super(Routes.HEAP_BLOCK, RouteType.GET);
    }

    protected initialize(): void {
        SharedSubscriptionManager.subscribe(
            SubscriptionType.NEW_BLOCK,
            (blockData: NewBlockSubscription) => {
                this.onNewBlock(blockData);
            },
        );
    }

    /**
     * GET /api/v1/heapBlock
     * @tag MotoSwap
     * @summary Get the current heap block of MotoSwap
     * @description Get the current heap block of MotoSwap (the block that is currently being processed)
     * @response 200 - Return the current heap block of the Bitcoin blockchain.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {HeapBlock} 200.application/json
     */
    protected async onRequest(
        _req: IHttpRequest,
        res: IHttpResponse,
        _next?: (err: Error | null | undefined, done: boolean | undefined) => unknown,
    ): Promise<void> {
        const currentBlockMsg: GetCurrentBlockMessage = {
            type: MessageType.GET_CURRENT_BLOCK,
            data: {},
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
            res.endWithoutBody();
        }
    }

    private onNewBlock(blockData: NewBlockSubscription): void {
        this.log(`New block: ${blockData.blockHash}`);
    }
}
