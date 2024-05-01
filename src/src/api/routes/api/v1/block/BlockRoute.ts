import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Binary } from 'mongodb';
import { ContractInformation } from '../../../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    BlockHeaderAPIDocumentWithTransactions,
    BlockWithTransactions,
    TransactionDocumentForAPI,
} from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { IContractAPIDocument } from '../../../../../db/documents/interfaces/IContractDocument.js';
import {
    DeploymentTransactionDocument,
    TransactionDocument,
} from '../../../../../db/interfaces/ITransactionDocument.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { BlockByHashParams } from '../../../../json-rpc/types/interfaces/params/BlockByHashParams.js';
import { BlockByIdParams } from '../../../../json-rpc/types/interfaces/params/BlockByIdParams.js';
import { BlockByIdResult } from '../../../../json-rpc/types/interfaces/results/BlockByIdResult.js';
import { Route } from '../../../Route.js';
import { SafeBigInt } from '../../../safe/SafeMath.js';

export abstract class BlockRoute<T extends Routes> extends Route<
    T,
    JSONRpcMethods.GET_BLOCK_BY_NUMBER | JSONRpcMethods.GET_BLOCK_BY_HASH,
    BlockHeaderAPIDocumentWithTransactions | undefined
> {
    protected cachedBlocks: Map<bigint | string, BlockHeaderAPIDocumentWithTransactions> =
        new Map();
    protected maxCacheSize: number = 100;

    protected currentBlockData: BlockHeaderAPIDocumentWithTransactions | undefined;

    protected constructor(route: T) {
        super(route, RouteType.GET);
    }

    public abstract getData(
        params: BlockByIdParams | BlockByHashParams,
    ): Promise<BlockHeaderAPIDocumentWithTransactions | undefined>;

    public abstract getDataRPC(
        params: BlockByIdParams | BlockByHashParams,
    ): Promise<BlockByIdResult | undefined>;

    public getParameterAsBoolean(params: BlockByIdParams | BlockByHashParams): boolean {
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

    protected initialize(): void {
        setInterval(() => {
            this.purgeCache();
        }, 60000);

        setInterval(() => {
            this.currentBlockData = undefined;
        }, 1000);
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
        const transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[] = [];

        if (data.transactions) {
            for (const transaction of data.transactions) {
                const revert = transaction.revert
                    ? Binary.createFromHexString(transaction.revert.toString('hex'))
                    : undefined;

                let newTx: TransactionDocumentForAPI<OPNetTransactionTypes> = {
                    ...transaction,
                    outputs: transaction.outputs.map((output) => {
                        return {
                            ...output,
                            value: output.value.toString(),
                        };
                    }),
                    revert: revert?.toString('base64'),
                    burnedBitcoin: transaction.burnedBitcoin.toString(),
                    _id: undefined,
                    blockHeight: undefined,
                    deployedTransactionHash: undefined,
                    deployedTransactionId: undefined,
                };

                delete newTx._id;
                delete newTx.blockHeight;

                if (newTx.OPNetType === OPNetTransactionTypes.Deployment) {
                    const txDeployment =
                        newTx as unknown as TransactionDocument<OPNetTransactionTypes> as DeploymentTransactionDocument;

                    const contractData = await this.getContractData(
                        txDeployment.contractAddress,
                        BigInt(data.block.height) + 1n,
                    );
                    if (contractData) {
                        newTx = {
                            ...newTx,
                            ...contractData,
                            deployedTransactionHash: undefined,
                            deployedTransactionId: undefined,
                        };
                    }
                }

                delete newTx.deployedTransactionId;
                delete newTx.deployedTransactionHash;

                transactions.push(newTx);
            }
        }

        return {
            ...data.block,
            transactions,
        };
    }

    private purgeCache() {
        this.cachedBlocks.clear();
    }

    private async getContractData(
        contractAddress: string,
        height: bigint,
    ): Promise<IContractAPIDocument | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const transactions: ContractInformation | undefined = await this.storage.getContractAt(
            contractAddress,
            height,
        );

        if (!transactions) return undefined;

        return this.convertToBlockHeaderAPIDocument(transactions);
    }

    private convertToBlockHeaderAPIDocument(data: ContractInformation): IContractAPIDocument {
        const document: IContractAPIDocument = {
            ...data,
            bytecode: data.bytecode.toString('base64'),
            deployerPubKey: data.deployerPubKey.toString('base64'),
            contractSeed: data.contractSeed.toString('base64'),
            contractSaltHash: data.contractSaltHash.toString('base64'),
            blockHeight: undefined,
            _id: undefined,
        };

        delete document.blockHeight;
        delete document._id;

        return document;
    }
}
