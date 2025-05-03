import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { BroadcastTransactionResult } from '../../../../json-rpc/types/interfaces/results/transactions/BroadcastTransactionResult.js';
import {
    BroadcastTransactionParams,
    BroadcastTransactionParamsAsArray,
    BroadcastTransactionParamsAsObject,
} from '../../../../json-rpc/types/interfaces/params/transactions/BroadcastTransactionParams.js';
import { RPCMessage } from '../../../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { MessageType } from '../../../../../threading/enum/MessageType.js';
import { ServerThread } from '../../../../ServerThread.js';
import { ThreadTypes } from '../../../../../threading/thread/enums/ThreadTypes.js';
import { BroadcastResponse } from '../../../../../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import { BroadcastOPNetRequest } from '../../../../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { TransactionSizeValidator } from '../../../../../poa/mempool/data-validator/TransactionSizeValidator.js';
import { Config } from '../../../../../config/Config.js';
import { Transaction } from '@btc-vision/bitcoin';

export class BroadcastTransaction extends Route<
    Routes.BROADCAST_TRANSACTION,
    JSONRpcMethods.BROADCAST_TRANSACTION,
    BroadcastTransactionResult | undefined
> {
    private readonly transactionSizeValidator: TransactionSizeValidator =
        new TransactionSizeValidator();

    private pendingRequests: number = 0;

    constructor() {
        super(Routes.BROADCAST_TRANSACTION, RouteType.POST);
    }

    public async getData(
        params: BroadcastTransactionParams,
    ): Promise<BroadcastTransactionResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        this.incrementPendingRequests();

        try {
            const [data, psbt] = this.getDecodedParams(params);
            const dataSize = data.length / 2;

            if (this.transactionSizeValidator.verifyTransactionSize(dataSize, psbt ?? false)) {
                this.decrementPendingRequests();

                return {
                    success: false,
                    result: 'Transaction too large',
                };
            }

            const parsedDataAsBuf = Buffer.from(data, 'hex');
            const tx = Transaction.fromBuffer(parsedDataAsBuf);
            const txHash = tx.getId();

            let parsedData: Uint8Array = Uint8Array.from(parsedDataAsBuf);
            const verification: BroadcastResponse | undefined = await this.verifyOPNetTransaction(
                parsedData,
                txHash,
                psbt ?? false,
            );

            if (!verification) {
                this.decrementPendingRequests();

                return {
                    success: false,
                    error: 'Could not broadcast transaction',
                };
            }

            if (psbt && verification.modifiedTransaction) {
                parsedData = Buffer.from(verification.modifiedTransaction, 'base64');
            }

            const isPsbt = verification.finalizedTransaction
                ? !verification.modifiedTransaction
                : !!psbt;

            if (verification.success && verification.result) {
                if (!parsedData) {
                    throw new Error('Could not parse data');
                }

                this.decrementPendingRequests();

                const result: BroadcastResponse | undefined = await this.broadcastOPNetTransaction(
                    parsedData,
                    isPsbt,
                    verification.result,
                );

                if (!result) {
                    return {
                        success: false,
                        error: 'Could not broadcast transaction',
                    };
                }

                return {
                    ...(verification as BroadcastTransactionResult),
                    ...(result as BroadcastTransactionResult),
                } as BroadcastTransactionResult;
            }

            this.decrementPendingRequests();

            return verification;
        } catch (e) {
            this.decrementPendingRequests();

            return {
                success: false,
                error: 'Could not broadcast transaction',
            };
        }
    }

    public async getDataRPC(
        params: BroadcastTransactionParams,
    ): Promise<BroadcastTransactionResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not broadcast transaction`);

        return data;
    }

    protected checkRateLimit(): boolean {
        return this.pendingRequests + 1 <= Config.API.MAXIMUM_TRANSACTION_BROADCAST;
    }

    protected incrementPendingRequests(): void {
        if (!this.checkRateLimit()) {
            throw new Error(`Too many broadcast pending requests.`);
        }

        this.pendingRequests++;
    }

    protected decrementPendingRequests(): void {
        this.pendingRequests--;
    }

    protected initialize(): void {}

    /**
     * POST /api/v1/transaction/broadcast
     * @tag Transactions
     * @summary Broadcast a transaction to the network.
     * @description Broadcast a fully signed transaction or a psbt transaction to the network.
     * @bodyContent {BroadcastTransactionParams} application/json
     * @response 200 - Return
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            req.body = await req.json();

            const params = this.getParams(req, res);
            if (!params) {
                throw new Error('Invalid params.');
            }

            const data = await this.getData(params);

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

    protected getParams(
        req: Request,
        res: Response,
    ): BroadcastTransactionParamsAsObject | undefined {
        if (!req.body) {
            throw new Error('Invalid params.');
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const data: string = req.body.data as string;
        if (!data) {
            res.status(400);
            res.json({ error: 'No data specified.' });
            return;
        }

        return {
            data,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            psbt: req.body.psbt == true,
        };
    }

    private async broadcastOPNetTransaction(
        data: Uint8Array,
        psbt: boolean,
        id: string,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET,
                    data: {
                        raw: data,
                        psbt,
                        id,
                    },
                } as BroadcastOPNetRequest,
            };

        return (await ServerThread.sendMessageToThread(ThreadTypes.P2P, currentBlockMsg)) as
            | BroadcastResponse
            | undefined;
    }

    private async verifyOPNetTransaction(
        raw: Uint8Array,
        id: string,
        psbt: boolean,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET,
                    data: {
                        id,
                        raw: raw,
                        psbt,
                    },
                } as BroadcastOPNetRequest,
            };

        return (await ServerThread.sendMessageToThread(ThreadTypes.MEMPOOL, currentBlockMsg)) as
            | BroadcastResponse
            | undefined;
    }

    private getDecodedParams(
        params: BroadcastTransactionParams,
    ): BroadcastTransactionParamsAsArray {
        if (Array.isArray(params)) {
            return params;
        } else {
            return [params.data, params.psbt];
        }
    }
}
