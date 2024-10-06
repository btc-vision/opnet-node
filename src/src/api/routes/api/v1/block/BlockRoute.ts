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
import { SafeBigInt } from '../../../safe/BlockParamsConverter.js';
import { DeploymentTxEncoder } from '../shared/DeploymentTxEncoder.js';
import { Config } from '../../../../../config/Config.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { AdvancedCaching } from '../../../../../caching/AdvancedCaching.js';

export abstract class BlockRoute<T extends Routes> extends Route<
    T,
    JSONRpcMethods.GET_BLOCK_BY_NUMBER | JSONRpcMethods.GET_BLOCK_BY_HASH,
    BlockHeaderAPIDocumentWithTransactions | undefined
> {
    protected cachedBlocks: AdvancedCaching<
        SafeBigInt | string,
        Promise<BlockHeaderAPIDocumentWithTransactions>
    > = new AdvancedCaching();
    protected currentBlockData: BlockHeaderAPIDocumentWithTransactions | undefined;

    protected readonly deploymentTxEncoder: DeploymentTxEncoder = new DeploymentTxEncoder();

    private pendingRequests: number = 0;

    protected constructor(route: T) {
        super(route, RouteType.GET);
    }

    public abstract getData(
        params: BlockByIdParams | BlockByHashParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined>;

    public abstract getDataRPC(
        params: BlockByIdParams | BlockByHashParams,
    ): Promise<BlockByIdResult | undefined>;

    public onBlockChange(_blockNumber: bigint, blockHeader: BlockHeaderAPIBlockDocument): void {
        this.currentBlockData = {
            ...blockHeader,
            transactions: [],
        };
    }

    protected async getCachedBlockData(
        includeTransactions: boolean,
        height?: SafeBigInt,
        hash?: string,
    ): Promise<BlockHeaderAPIDocumentWithTransactions> {
        const heightOrHash = height || hash;
        if (!heightOrHash) {
            throw new Error('No height or hash provided');
        }

        if (heightOrHash === -1 && this.currentBlockData && !includeTransactions) {
            return this.currentBlockData;
        }

        const documentKey = `${heightOrHash}${includeTransactions}`;
        const cachedData = await this.getCachedData(documentKey);
        if (cachedData) {
            console.log('From cache.');

            return cachedData;
        }

        this.setToCache(documentKey, this.getBlockData(includeTransactions, height, hash));

        const cachedKey = this.getCachedData(documentKey);
        if (!cachedKey) {
            throw new Error('No cached key found');
        }

        return cachedKey;
    }

    protected async getBlockData(
        includeTransactions: boolean,
        height?: SafeBigInt,
        hash?: string,
    ): Promise<BlockHeaderAPIDocumentWithTransactions> {
        const heightOrHash = height || hash;
        if (!heightOrHash) {
            throw new Error('No height or hash provided');
        }

        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const transactions: BlockWithTransactions | undefined = hash
            ? await this.storage.getBlockTransactions(undefined, hash, includeTransactions)
            : await this.storage.getBlockTransactions(height, undefined, includeTransactions);

        if (!transactions) {
            throw new Error(`No transactions found for block ${heightOrHash}`);
        }

        return this.convertToBlockHeaderAPIDocumentWithTransactions(transactions);
    }

    protected checkRateLimit(): boolean {
        return this.pendingRequests + 1 <= Config.API.MAXIMUM_PARALLEL_BLOCK_QUERY;
    }

    protected incrementPendingRequests(): void {
        if (!this.checkRateLimit()) {
            throw new Error('Too many block pending requests');
        }

        this.pendingRequests++;
    }

    protected decrementPendingRequests(): void {
        this.pendingRequests--;
    }

    protected initialize(): void {}

    protected abstract onRequest(
        _req: Request,
        res: Response,
        _next?: MiddlewareNext,
    ): Promise<void>;

    protected getCachedData(
        height: string,
    ): Promise<BlockHeaderAPIDocumentWithTransactions> | undefined {
        return this.cachedBlocks.get(height);
    }

    protected setToCache(
        height: SafeBigInt | string,
        data: Promise<BlockHeaderAPIDocumentWithTransactions>,
    ) {
        this.cachedBlocks.set(height, data);
    }

    protected async convertToBlockHeaderAPIDocumentWithTransactions(
        data: BlockWithTransactions,
    ): Promise<BlockHeaderAPIDocumentWithTransactions> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[] = [];
        const blockId = BigInt(data.block.height);

        if (data.transactions) {
            for (const transaction of data.transactions) {
                let newTx = TransactionConverterForAPI.convertTransactionToAPI(transaction);

                newTx = await this.deploymentTxEncoder.addDeploymentData(
                    newTx,
                    blockId,
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
