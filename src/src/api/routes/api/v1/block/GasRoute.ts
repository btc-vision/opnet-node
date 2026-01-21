import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { BlockGasInformation } from '../../../../json-rpc/types/interfaces/results/blocks/BlockGasInformation.js';
import { OPNetConsensus } from '../../../../../poc/configurations/OPNetConsensus.js';
import { BlockGasPredictor } from '../../../../../blockchain-indexer/processor/gas/BlockGasPredictor.js';
import { RPCMessage } from '../../../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { MessageType } from '../../../../../threading/enum/MessageType.js';
import { ServerThread } from '../../../../ServerThread.js';
import { ThreadTypes } from '../../../../../threading/thread/enums/ThreadTypes.js';
import {
    FeeMessageResponse,
    FeeRequestMessageData,
} from '../../../../../threading/interfaces/thread-messages/messages/api/FeeRequest.js';

export class GasRoute extends Route<Routes.GAS, JSONRpcMethods.GAS, BlockGasInformation> {
    private cachedBlock: Promise<BlockGasInformation | undefined> | BlockGasInformation | undefined;

    private cacheBlockFee:
        | FeeMessageResponse
        | undefined
        | null
        | Promise<FeeMessageResponse | undefined | null>;

    private fetchFeeInterval: number = 1000 * 30;
    private isInitialized: boolean = false;

    constructor() {
        super(Routes.GAS, RouteType.GET);
    }

    public async requestMempoolFee(): Promise<FeeMessageResponse | undefined> {
        const feeRequest: RPCMessage<BitcoinRPCThreadMessageType.GET_MEMPOOL_FEES> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.GET_MEMPOOL_FEES,
            } as FeeRequestMessageData,
        };

        const feeResponse: FeeMessageResponse | null = (await ServerThread.sendMessageToThread(
            ThreadTypes.MEMPOOL,
            feeRequest,
            false,
        )) as FeeMessageResponse | null;

        if (!feeResponse) {
            throw new Error('Failed to fetch mempool fee data.');
        }

        return feeResponse;
    }

    public async getData(): Promise<BlockGasInformation> {
        const latestBlock = await this.getBlockHeader();
        if (!latestBlock) {
            throw new Error('Could not fetch latest block header. Is this node synced?');
        }

        let fee = await this.cacheBlockFee;
        if (fee === null) {
            this.fetchFee();

            fee = await this.cacheBlockFee;
        }

        if (fee) {
            latestBlock.bitcoin = fee.bitcoinFees;
        }

        return latestBlock;
    }

    public async getDataRPC(): Promise<BlockGasInformation> {
        const data = await this.getData();
        if (!data) throw new Error(`Block not found at given height.`);

        return data;
    }

    public onBlockChange(_blockNumber: bigint, blockHeader: BlockHeaderAPIBlockDocument): void {
        this.cachedBlock = this.cacheResponse(blockHeader);

        if (this.isInitialized) this.fetchFee();
    }

    protected initialize(): void {
        setTimeout(() => {
            this.isInitialized = true;
            this.fetchFeeLoop();
        }, 5000);
    }

    /**
     * GET /api/v1/block/gas
     * @tag Block
     * @summary Get the next block gas information
     * @description This endpoint returns the information needed to calculate the gas price accurately for a transaction.
     * @response 200 - Returns the gas information for the next block
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {string} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const data = await this.getData();

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch latest block header. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private bigIntToHex(value: bigint): string {
        return `0x${value.toString(16)}`;
    }

    private fetchFeeLoop(): void {
        this.fetchFee();

        setTimeout(() => {
            this.fetchFeeLoop();
        }, this.fetchFeeInterval);
    }

    private fetchFee(): void {
        this.cacheBlockFee = this.requestMempoolFee().catch((err: unknown) => {
            this.warn(`Failed to fetch mempool fee data: ${err}`);

            return null;
        });
    }

    private async cacheResponse(
        data:
            | BlockHeaderAPIBlockDocument
            | undefined
            | Promise<BlockHeaderAPIBlockDocument | undefined>,
    ): Promise<BlockGasInformation | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const latestBlock = await data;
        if (!latestBlock) {
            return;
        }

        const gasUsed: bigint = BigInt(latestBlock.gasUsed);
        const ema: bigint = BigInt(latestBlock.ema);
        const baseGas: bigint = BigInt(latestBlock.baseGas);

        const gasPerSat: bigint =
            (OPNetConsensus.consensus.GAS.SAT_TO_GAS_RATIO * baseGas) /
            BlockGasPredictor.scalingFactor;

        return {
            blockNumber: this.bigIntToHex(BigInt(latestBlock.height)),
            gasUsed: this.bigIntToHex(gasUsed),
            targetGasLimit: this.bigIntToHex(OPNetConsensus.consensus.GAS.TARGET_GAS),
            gasLimit: this.bigIntToHex(OPNetConsensus.consensus.GAS.MAX_THEORETICAL_GAS),

            ema: this.bigIntToHex(ema),
            baseGas: this.bigIntToHex(baseGas),

            gasPerSat: this.bigIntToHex(gasPerSat),
            bitcoin: {
                conservative: '5',
                recommended: {
                    low: '1.5',
                    medium: '2.5',
                    high: '5',
                },
            },
        };
    }

    private async getBlockHeader(): Promise<BlockGasInformation | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        if (this.cachedBlock) {
            return this.cachedBlock;
        }

        this.cachedBlock = this.cacheResponse(this.storage.getLatestBlock());

        return await this.cachedBlock;
    }
}
