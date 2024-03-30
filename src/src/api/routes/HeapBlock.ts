import { IHttpRequest, IHttpResponse } from 'nanoexpress';
import { SubscriptionType } from '../../blockchain-indexer/shared/enums/Subscriptions.js';
import { NewBlockSubscription } from '../../blockchain-indexer/shared/interfaces/NewBlockSubscription.js';
import { SharedSubscriptionManager } from '../../blockchain-indexer/shared/subscription/SharedSubscriptionManager.js';
import { Routes, RouteType } from '../enums/Routes.js';
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

    private onNewBlock(blockData: NewBlockSubscription): void {
        this.log(`New block: ${blockData.blockHash}`);
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
    protected onRequest(
        req: IHttpRequest,
        res: IHttpResponse,
        next?: (err: Error | null | undefined, done: boolean | undefined) => unknown,
    ): void {
        try {
            res.status(200);

            res.json({ api: 'is working!' });
        } catch (err: unknown) {
            let e = err as Error;
            this.error(e.stack);
        }
    }
}
