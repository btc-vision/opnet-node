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

export class BroadcastTransaction extends Route<
    Routes.BROADCAST_TRANSACTION,
    JSONRpcMethods.BROADCAST_TRANSACTION,
    BroadcastTransactionResult | undefined
> {
    constructor() {
        super(Routes.BROADCAST_TRANSACTION, RouteType.POST);
    }

    public async getData(
        params: BroadcastTransactionParams,
    ): Promise<BroadcastTransactionResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const [data, psbt] = this.getDecodedParams(params);
        let parsedData: Uint8Array = Uint8Array.from(Buffer.from(data, 'hex'));

        const verification = await this.verifyOPNetTransaction(parsedData, psbt ?? false);
        if (!verification) {
            return {
                success: false,
                error: 'Could not broadcast transaction',
                identifier: 0n,
            };
        }

        if (psbt && verification.modifiedTransaction) {
            parsedData = Buffer.from(verification.modifiedTransaction, 'base64');
        }

        const isPsbt = verification.finalizedTransaction
            ? !verification.modifiedTransaction
            : !!psbt;

        console.log('Broadcasting transaction', verification);

        if (verification.success) {
            return {
                ...verification,
                ...(await this.broadcastOPNetTransaction(parsedData, isPsbt)),
            };
        }

        return verification;
    }

    public async getDataRPC(
        params: BroadcastTransactionParams,
    ): Promise<BroadcastTransactionResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Could not broadcast transaction`);

        return data;
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

        const data: string = req.body.data as string;
        if (!data) {
            res.status(400);
            res.json({ error: 'No data specified.' });
            return;
        }

        return {
            data,
            psbt: req.body.psbt == true,
        };
    }

    private async broadcastOPNetTransaction(
        data: Uint8Array,
        psbt: boolean,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET,
                    data: {
                        raw: data,
                        psbt,
                    },
                } as BroadcastOPNetRequest,
            };

        return (await ServerThread.sendMessageToThread(ThreadTypes.PoA, currentBlockMsg)) as
            | BroadcastResponse
            | undefined;
    }

    private async verifyOPNetTransaction(
        raw: Uint8Array,
        psbt: boolean,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET,
                    data: {
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
