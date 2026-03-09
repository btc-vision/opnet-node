import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
import { fromHex, Transaction } from '@btc-vision/bitcoin';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import {
    BroadcastTransactionPackageParams,
    BroadcastTransactionPackageParamsAsObject,
} from '../../../../json-rpc/types/interfaces/params/transactions/BroadcastTransactionPackageParams.js';
import {
    BroadcastTransactionPackageResult,
    SequentialBroadcastTxResult,
} from '../../../../json-rpc/types/interfaces/results/transactions/BroadcastTransactionPackageResult.js';
import { RPCMessage } from '../../../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { MessageType } from '../../../../../threading/enum/MessageType.js';
import { ServerThread } from '../../../../ServerThread.js';
import { ThreadTypes } from '../../../../../threading/thread/enums/ThreadTypes.js';
import {
    BroadcastOPNetRequest,
    BroadcastPackageOPNetRequest,
    OPNetBroadcastData,
} from '../../../../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { MempoolPackageBroadcastResponse } from '../../../../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionPackageOPNet.js';
import { Config } from '../../../../../config/Config.js';
import { WSManager } from '../../../../websocket/WebSocketManager.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { MempoolTransactionNotificationMessage } from '../../../../../threading/interfaces/thread-messages/messages/api/MempoolTransactionNotification.js';

const MAX_PACKAGE_SIZE = 25;

export class BroadcastTransactionPackage extends Route<
    Routes.BROADCAST_TRANSACTION_PACKAGE,
    JSONRpcMethods.BROADCAST_TRANSACTION_PACKAGE,
    BroadcastTransactionPackageResult | undefined
> {
    private pendingRequests: number = 0;

    constructor() {
        super(Routes.BROADCAST_TRANSACTION_PACKAGE, RouteType.POST);
    }

    public async getData(
        params: BroadcastTransactionPackageParams,
    ): Promise<BroadcastTransactionPackageResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        this.incrementPendingRequests();

        try {
            const [txs, isPackage] = this.getDecodedParams(params);

            this.validateTxs(txs);

            // Parse each tx to get raw bytes + txHash for MEMPOOL
            const parsedTxs: Array<{ raw: Uint8Array; id: string; rawHex: string }> = [];
            for (const rawHex of txs) {
                const parsedData = fromHex(rawHex);
                const tx = Transaction.fromBuffer(Uint8Array.from(parsedData));
                parsedTxs.push({ raw: parsedData, id: tx.getId(), rawHex });
            }

            // Send to MEMPOOL thread, handles OPNet verify/decode, Bitcoin Core
            // broadcast (submitPackage or testMempoolAccept+sendRawTransaction),
            // and MongoDB storage. All in one shot.
            const mempoolResult = await this.sendToMempool(parsedTxs, isPackage);
            if (!mempoolResult) {
                return {
                    success: false,
                    error: 'MEMPOOL thread returned no response',
                };
            }

            // P2P propagation + WS notifications for each individually successful tx,
            // regardless of overall success (partial sequential failures still have
            // earlier txs that succeeded and need propagation).
            for (const txResult of mempoolResult.txResults) {
                if (!txResult.success) continue;

                const parsed = parsedTxs.find((t) => t.id === txResult.txid);
                if (parsed) {
                    await this.broadcastOPNetTransaction(parsed.raw, txResult.txid);
                }

                this.notifyMempoolTransaction(txResult.txid, txResult.transactionType);
            }

            // Map MEMPOOL response to API response
            const sequentialResults: SequentialBroadcastTxResult[] = mempoolResult.txResults.map(
                (r) => ({
                    txid: r.txid,
                    success: r.success,
                    error: r.error,
                }),
            );

            return {
                success: mempoolResult.success,
                error: mempoolResult.error,
                packageResult: mempoolResult.packageResult,
                testResults: mempoolResult.testResults,
                sequentialResults: sequentialResults.length > 0 ? sequentialResults : undefined,
                fellBackToSequential: mempoolResult.fellBackToSequential,
            };
        } catch {
            return {
                success: false,
                error: 'Could not broadcast transaction package',
            };
        } finally {
            this.decrementPendingRequests();
        }
    }

    public async getDataRPC(
        params: BroadcastTransactionPackageParams,
    ): Promise<BroadcastTransactionPackageResult | undefined> {
        const data = await this.getData(params);
        if (!data) throw new Error('Could not broadcast transaction package');

        return data;
    }

    protected initialize(): void {}

    /**
     * POST /api/v1/transaction/broadcast-package
     * @tag Transactions
     * @summary Broadcast a package of transactions to the network.
     * @description Broadcast an ordered array of raw transactions atomically via submitPackage
     *              or sequentially with testMempoolAccept pre-validation.
     * @bodyContent {BroadcastTransactionPackageParams} application/json
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
                return; // getParams already sent error response
            }

            const data = await this.getData(params);

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, {
                    error: 'Could not broadcast transaction package.',
                });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(
        req: Request,
        res: Response,
    ): BroadcastTransactionPackageParamsAsObject | undefined {
        if (!req.body) {
            throw new Error('Invalid params.');
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const txs: unknown = req.body.txs;
        if (!Array.isArray(txs) || txs.length === 0) {
            this.safeJson(res, 400, { error: 'txs must be a non-empty array of hex strings.' });
            return;
        }

        if (txs.length > MAX_PACKAGE_SIZE) {
            this.safeJson(res, 400, {
                error: `txs array exceeds maximum size of ${MAX_PACKAGE_SIZE}.`,
            });
            return;
        }

        for (let i = 0; i < txs.length; i++) {
            if (typeof txs[i] !== 'string' || (txs[i] as string).length === 0) {
                this.safeJson(res, 400, {
                    error: `txs[${i}] must be a non-empty hex string.`,
                });
                return;
            }
        }

        return {
            txs: txs as string[],
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            isPackage: req.body.isPackage !== false,
        };
    }

    private validateTxs(txs: string[]): void {
        if (!Array.isArray(txs) || txs.length === 0) {
            throw new Error('txs must be a non-empty array of hex strings.');
        }

        if (txs.length > MAX_PACKAGE_SIZE) {
            throw new Error(`txs array exceeds maximum size of ${MAX_PACKAGE_SIZE}.`);
        }

        for (let i = 0; i < txs.length; i++) {
            if (typeof txs[i] !== 'string' || txs[i].length === 0) {
                throw new Error(`txs[${i}] must be a non-empty hex string.`);
            }
        }
    }

    private incrementPendingRequests(): void {
        this.pendingRequests++;
        if (this.pendingRequests > Config.API.MAXIMUM_TRANSACTION_BROADCAST) {
            this.pendingRequests--;
            throw new Error('Too many broadcast pending requests.');
        }
    }

    private decrementPendingRequests(): void {
        this.pendingRequests--;
    }

    /** Send package to MEMPOOL thread for OPNet verify/decode + Bitcoin Core broadcast + MongoDB storage. */
    private async sendToMempool(
        txs: Array<{ raw: Uint8Array; id: string }>,
        isPackage: boolean,
    ): Promise<MempoolPackageBroadcastResponse | undefined> {
        const msg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_PACKAGE_OPNET> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_PACKAGE_OPNET,
                data: {
                    txs: txs.map((t) => ({ raw: t.raw, id: t.id })),
                    isPackage,
                },
            } as BroadcastPackageOPNetRequest,
        };

        return (await ServerThread.sendMessageToThread(ThreadTypes.MEMPOOL, msg)) as
            | MempoolPackageBroadcastResponse
            | undefined;
    }

    /** Send to P2P thread for OPNet network propagation. */
    private async broadcastOPNetTransaction(data: Uint8Array, id: string): Promise<void> {
        const msg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET,
                data: {
                    raw: data,
                    psbt: false,
                    id,
                } as OPNetBroadcastData,
            } as BroadcastOPNetRequest,
        };

        try {
            await ServerThread.sendMessageToThread(ThreadTypes.P2P, msg);
        } catch (e) {
            const errorDetails = e instanceof Error ? (e.stack ?? e.message) : String(e);
            this.error(`Failed to propagate transaction ${id} to P2P: ${errorDetails}`);
        }
    }

    /** Notify WS subscribers and other API threads of a new mempool transaction. */
    private notifyMempoolTransaction(txId: string, transactionType?: OPNetTransactionTypes): void {
        const txType = transactionType ?? OPNetTransactionTypes.Generic;

        WSManager.onMempoolTransaction(txId, txType);

        const notification: MempoolTransactionNotificationMessage = {
            type: MessageType.NOTIFY_MEMPOOL_TRANSACTION,
            data: {
                txId,
                transactionType: txType,
            },
        };

        void ServerThread.sendMessageToAllThreads(ThreadTypes.API, notification).catch(
            (e: unknown) => {
                const errorDetails = e instanceof Error ? (e.stack ?? e.message) : String(e);
                this.error(`Failed to notify API threads of mempool transaction: ${errorDetails}`);
            },
        );
    }

    private getDecodedParams(params: BroadcastTransactionPackageParams): [string[], boolean] {
        if (Array.isArray(params)) {
            return [params[0], params[1] !== false];
        } else {
            return [params.txs, params.isPackage !== false];
        }
    }
}
