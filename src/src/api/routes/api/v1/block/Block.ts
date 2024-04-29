import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    BlockHeaderAPIDocumentWithTransactions,
    BlockWithTransactions,
    TransactionDocumentForAPI,
} from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { Route } from '../../../Route.js';

export class Block extends Route<Routes.BLOCK, BlockHeaderAPIDocumentWithTransactions | undefined> {
    private cachedBlocks: Map<bigint, BlockHeaderAPIDocumentWithTransactions> = new Map();
    private maxCacheSize: number = 100;

    private currentBlockData: BlockHeaderAPIDocumentWithTransactions | undefined;

    constructor() {
        super(Routes.BLOCK, RouteType.GET);
    }

    protected initialize(): void {
        setInterval(() => {
            this.purgeCache();
        }, 60000);

        setInterval(() => {
            this.currentBlockData = undefined;
        }, 1000);
    }

    /**
     * GET /api/v1/block
     * @tag OpNet
     * @summary Get a block and its transactions by height.
     * @queryParam {uint64} [height] - The height of the block to fetch.
     * @description Get the requested block and its transactions.
     * @response 200 - Return the requested block and its transactions.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {Block} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const height = _req.query.height as string | undefined;
            const bigintHeight = height ? BigInt(height) : -1;

            const data = await this.getData(bigintHeight);

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

    protected async getData(
        height: bigint | -1 = -1,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined> {
        const cachedData = this.getCachedData(height);
        if (cachedData) return cachedData;

        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const transactions = await this.storage.getBlockTransactions(height);
        if (!transactions) return undefined;

        const data = this.convertToBlockHeaderAPIDocumentWithTransactions(transactions);
        if (height !== -1) this.setToCache(height, data);
        else this.currentBlockData = data;

        return data;
    }

    private getCachedData(height: bigint | -1): BlockHeaderAPIDocumentWithTransactions | undefined {
        if (height === -1) {
            return this.currentBlockData;
        }

        return this.cachedBlocks.get(height);
    }

    private purgeCache() {
        this.cachedBlocks.clear();
    }

    private setToCache(height: bigint, data: BlockHeaderAPIDocumentWithTransactions) {
        if (this.cachedBlocks.size >= this.maxCacheSize) {
            this.purgeCache();
        }

        this.cachedBlocks.set(height, data);
    }

    private convertToBlockHeaderAPIDocumentWithTransactions(
        data: BlockWithTransactions,
    ): BlockHeaderAPIDocumentWithTransactions {
        const transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[] = [];

        for (const transaction of data.transactions) {
            const newTx: TransactionDocumentForAPI<OPNetTransactionTypes> = {
                ...transaction,
                outputs: transaction.outputs.map((output) => {
                    return {
                        ...output,
                        value: output.value.toString(),
                    };
                }),
                revert: transaction.revert?.toString('hex') ?? undefined,
                burnedBitcoin: transaction.burnedBitcoin.toString(),
                _id: undefined,
                blockHeight: undefined,
            };

            delete newTx._id;
            delete newTx.blockHeight;

            transactions.push(newTx);
        }

        return {
            ...data.block,
            transactions,
        };
    }
}
