import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    BlockHeaderAPIDocumentWithTransactions,
    BlockWithTransactions,
    TransactionDocumentForAPI,
} from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { TransactionConverterForAPI } from '../../../../data-converter/TransactionConverterForAPI.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByHashParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByHashParams.js';
import { BlockByIdParams } from '../../../../json-rpc/types/interfaces/params/blocks/BlockByIdParams.js';
import { BlockByIdResult } from '../../../../json-rpc/types/interfaces/results/blocks/BlockByIdResult.js';
import { Route } from '../../../Route.js';
import { SafeBigInt } from '../../../safe/SafeMath.js';
import { DeploymentTxEncoder } from '../shared/DeploymentTxEncoder.js';

export abstract class BlockRoute<T extends Routes> extends Route<
    T,
    JSONRpcMethods.GET_BLOCK_BY_NUMBER | JSONRpcMethods.GET_BLOCK_BY_HASH,
    BlockHeaderAPIDocumentWithTransactions | undefined
> {
    protected cachedBlocks: Map<bigint | string, BlockHeaderAPIDocumentWithTransactions> =
        new Map();
    protected maxCacheSize: number = 100;

    protected currentBlockData: BlockHeaderAPIDocumentWithTransactions | undefined;
    protected readonly deploymentTxEncoder: DeploymentTxEncoder = new DeploymentTxEncoder();

    protected constructor(route: T) {
        super(route, RouteType.GET);
    }

    public abstract getData(
        params: BlockByIdParams | BlockByHashParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined>;

    public abstract getDataRPC(
        params: BlockByIdParams | BlockByHashParams,
    ): Promise<BlockByIdResult | undefined>;

    protected initialize(): void {
        setInterval(() => {
            this.purgeCache();
        }, 30000);

        setInterval(() => {
            this.currentBlockData = undefined;
        }, 2000);
    }

    protected abstract onRequest(
        _req: Request,
        res: Response,
        _next?: MiddlewareNext,
    ): Promise<void>;

    protected getCachedData(
        height: SafeBigInt | string,
    ): BlockHeaderAPIDocumentWithTransactions | undefined {
        if (height === -1) {
            return this.currentBlockData;
        }

        return this.cachedBlocks.get(height);
    }

    protected setToCache(height: bigint | string, data: BlockHeaderAPIDocumentWithTransactions) {
        if (this.cachedBlocks.size >= this.maxCacheSize) {
            this.purgeCache();
        }

        this.cachedBlocks.set(height, data);
    }

    protected async convertToBlockHeaderAPIDocumentWithTransactions(
        data: BlockWithTransactions,
    ): Promise<BlockHeaderAPIDocumentWithTransactions> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[] = [];
        if (data.transactions) {
            for (const transaction of data.transactions) {
                let newTx = TransactionConverterForAPI.convertTransactionToAPI(transaction);

                newTx = await this.deploymentTxEncoder.addDeploymentData(
                    newTx,
                    BigInt(data.block.height),
                    this.storage,
                );

                transactions.push(newTx);
            }
        }

        return {
            ...data.block,
            transactions,
        };
    }

    protected getParameterAsBoolean(params: BlockByIdParams | BlockByHashParams): boolean {
        const isArray = Array.isArray(params);

        let includeTransactions;
        if (isArray) {
            includeTransactions = params.shift();

            if (typeof includeTransactions !== 'boolean') {
                includeTransactions = false;
            }
        } else {
            includeTransactions = params.sendTransactions ?? false;
        }

        return includeTransactions;
    }

    private purgeCache() {
        this.cachedBlocks.clear();
    }
}
