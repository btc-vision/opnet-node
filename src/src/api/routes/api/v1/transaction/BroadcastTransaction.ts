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
import {
    BroadcastRequest,
    BroadcastResponse,
} from '../../../../../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import { BroadcastOPNetRequest } from '../../../../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { PSBTTransactionVerifier } from '../../../../../blockchain-indexer/processor/transaction/psbt/PSBTTransactionVerifier.js';

export class BroadcastTransaction extends Route<
    Routes.BROADCAST_TRANSACTION,
    JSONRpcMethods.BROADCAST_TRANSACTION,
    BroadcastTransactionResult | undefined
> {
    private readonly psbtVerifier: PSBTTransactionVerifier = new PSBTTransactionVerifier();

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

        let result: BroadcastResponse | null;
        if (!psbt) {
                result = {
            result = (await this.broadcastTransactionToBitcoinCore(data)) || {
                success: false,
                result: 'Could not broadcast transaction to the network.',
            };
        } else {
            result = this.psbtVerifier.verify(data)
                ? {
                      success: true,
                      result: 'Valid PSBT transaction.',
                  }
                : {
                      success: false,
                      result: 'Invalid PSBT transaction.',
                  };
        }

        if (!result.error) {
            return {
                ...(await this.broadcastOPNetTransaction(data, psbt ?? false)),
                ...result,
            };
        } else {
            return result;
        }
    }

    public async getDataRPC(
        params: BroadcastTransactionParams,
    ): Promise<BroadcastTransactionResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error(`Contract bytecode not found at the specified address.`);

        return data;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/transaction/broadcast
     * @tag Transaction
     * @summary Broadcast a transaction to the network.
     * @description Broadcast a fully signed transaction or a psbt transaction to the network.
     * @response 200 - Return
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const params = this.getParams(req, res);
            if (!params) return;

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
        data: string,
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

    private async broadcastTransactionToBitcoinCore(
        data: string,
    ): Promise<BroadcastResponse | null> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE,
                    data: data,
                } as BroadcastRequest,
            };

        return (await ServerThread.sendMessageToThread(
            ThreadTypes.BITCOIN_RPC,
            currentBlockMsg,
        )) as BroadcastResponse | null;
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
