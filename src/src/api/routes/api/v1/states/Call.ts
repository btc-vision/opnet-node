import { Address, BufferHelper } from '@btc-vision/transaction';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { Config } from '../../../../../config/Config.js';
import { MessageType } from '../../../../../threading/enum/MessageType.js';
import {
    CallRequest,
    CallRequestResponse,
} from '../../../../../threading/interfaces/thread-messages/messages/api/CallRequest.js';
import { RPCMessage } from '../../../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { ThreadTypes } from '../../../../../threading/thread/enums/ThreadTypes.js';
import {
    BlockchainStorageMap,
    EvaluatedEvents,
} from '../../../../../vm/evaluated/EvaluatedResult.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { CallParams } from '../../../../json-rpc/types/interfaces/params/states/CallParams.js';
import {
    AccessList,
    AccessListItem,
    CallResult,
    ContractEvents,
} from '../../../../json-rpc/types/interfaces/results/states/CallResult.js';
import { ServerThread } from '../../../../ServerThread.js';
import { Route } from '../../../Route.js';
import { EventReceiptDataForAPI } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions';
import { AddressVerificator } from '@btc-vision/transaction';

export class Call extends Route<Routes.CALL, JSONRpcMethods.CALL, CallResult | undefined> {
    private pendingRequests: number = 0;

    constructor() {
        super(Routes.CALL, RouteType.GET);
    }

    public static async requestThreadExecution(
        to: Address,
        calldata: string,
        from?: Address,
        blockNumber?: bigint,
    ): Promise<CallRequestResponse> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.CALL> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.CALL,
                data: {
                    to: to,
                    calldata: calldata,
                    from: from,
                    blockNumber: blockNumber,
                },
            } as CallRequest,
        };

        const currentBlock: CallRequestResponse | null = (await ServerThread.sendMessageToThread(
            ThreadTypes.RPC,
            currentBlockMsg,
        )) as CallRequestResponse | null;

        if (!currentBlock) {
            throw new Error(`Failed to execute the given calldata at the requested contract.`);
        }

        return currentBlock;
    }

    public async getData(_params: CallParams): Promise<CallResult | undefined> {
        this.incrementPendingRequests();

        try {
            if (!this.storage) {
                throw new Error('Storage not initialized');
            }

            const [to, calldata, from, blockNumber] = this.getDecodedParams(_params);
            const res: CallRequestResponse = await Call.requestThreadExecution(
                to,
                calldata,
                from,
                blockNumber,
            );

            if (!res) {
                throw new Error(`Failed to execute the given calldata at the requested contract.`);
            }

            this.decrementPendingRequests();
            return this.convertDataToResult(res);
        } catch (e) {
            this.decrementPendingRequests();

            if (Config.DEV.DEBUG_TRANSACTION_FAILURE) {
                this.error(
                    `Failed to execute the given calldata at the requested contract: ${(e as Error).stack}`,
                );
            }

            throw `Something went wrong while simulating call.`;
        }
    }

    public async getDataRPC(params: CallParams): Promise<CallResult | undefined> {
        const data = await this.getData(params);
        if (!data)
            throw new Error(`Could not execute the given calldata at the requested contract.`);

        return data;
    }

    protected checkRateLimit(): boolean {
        return this.pendingRequests + 1 <= Config.API.MAXIMUM_PENDING_CALL_REQUESTS;
    }

    protected incrementPendingRequests(): void {
        if (!this.checkRateLimit()) {
            throw new Error(`Too many pending call requests.`);
        }

        this.pendingRequests++;
    }

    protected decrementPendingRequests(): void {
        this.pendingRequests--;
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/states/call
     * @tag States
     * @summary Call a contract function with a given calldata.
     * @description Call a contract function with the given address, data, and value.
     * @queryParam {string} to - The address of the contract.
     * @queryParam {string} data - The calldata of the contract function.
     * @queryParam {string} [from] - The address of the sender.
     * @response 200 - Return the result of the contract function call.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {object} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
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
                res.json({
                    error: 'Could not execute the given calldata at the requested contract.',
                });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    protected getParams(req: Request, res: Response): CallParams | undefined {
        if (!req.query) {
            throw new Error('Invalid params.');
        }

        const to = req.query.to as string;
        const data = req.query.data as string;
        const from = req.query.from as string;
        const blockNumber = req.query.blockNumber as string;

        if (!to || to.length < 50) {
            res.status(400);
            res.json({ error: 'Invalid address. Address must be P2TR (taproot).' });
            return;
        }

        if (!data || data.length < 4) {
            res.status(400);
            res.json({ error: 'Invalid calldata.' });
            return;
        }

        return {
            to,
            calldata: data,
            from,
            blockNumber,
        };
    }

    private convertDataToResult(data: CallRequestResponse): CallResult {
        if ('error' in data) {
            return data;
        }

        if (!data.result) {
            throw new Error(`Could not execute the given calldata at the requested contract.`);
        }

        const result: string = Buffer.from(data.result).toString('base64');
        const accessList: AccessList = data.changedStorage
            ? this.getAccessList(data.changedStorage)
            : {};

        const response: CallResult = {
            result: result,
            events: this.convertEventToResult(data.events),
            accessList,
            estimatedGas: '0x' + (data.gasUsed || 0).toString(16),
        };

        if (data.revert) {
            response.revert = data.revert.toString();
        }

        return response;
    }

    private convertEventToResult(events: EvaluatedEvents | undefined): ContractEvents {
        const contractEvents: ContractEvents = {};

        if (events) {
            for (const [contract, contractEventsList] of events) {
                const contractEventsListResult: EventReceiptDataForAPI[] = [];

                for (const event of contractEventsList) {
                    const eventResult: EventReceiptDataForAPI = {
                        contractAddress: contract,
                        eventType: event.eventType,
                        eventDataSelector: event.eventDataSelector.toString(),
                        eventData: Buffer.from(event.eventData).toString('base64'),
                    };

                    contractEventsListResult.push(eventResult);
                }

                contractEvents[contract] = contractEventsListResult;
            }
        }

        return contractEvents;
    }

    private getAccessList(changedStorage: BlockchainStorageMap): AccessList {
        const accessList: AccessList = {};

        for (const [contract, pointerStorage] of changedStorage) {
            const accessListItem: AccessListItem = {};

            for (const [key, value] of pointerStorage) {
                const keyStr: string = Buffer.from(BufferHelper.pointerToUint8Array(key)).toString(
                    'base64',
                );

                accessListItem[keyStr] = Buffer.from(
                    BufferHelper.pointerToUint8Array(value),
                ).toString('base64');
            }

            accessList[contract] = accessListItem;
        }

        return accessList;
    }

    private getDecodedParams(
        params: CallParams,
    ): [Address, string, Address | undefined, bigint | undefined] {
        let address: Address | undefined;
        let calldata: string | undefined;
        let from: Address | undefined;
        let blockNumber: bigint | undefined;

        if (Array.isArray(params)) {
            address = params.shift();
            calldata = params.shift();
            from = params.shift();
            blockNumber = params.shift() as bigint | undefined;
        } else {
            address = params.to;
            calldata = params.calldata;
            from = params.from;
            blockNumber = params.blockNumber ? BigInt(params.blockNumber) : undefined;
        }

        if (!address) {
            throw new Error('Receiver address not provided.');
        }

        if (!AddressVerificator.validateBitcoinAddress(address, this.network)) {
            throw new Error(`Address ${address} is not a valid Bitcoin address.`);
        }

        if (!calldata || calldata.length < 1) throw new Error(`Invalid calldata specified.`);

        return [address, calldata, from, blockNumber];
    }
}
