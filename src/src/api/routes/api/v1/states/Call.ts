import { AddressVerificator, BufferHelper, NetEvent } from '@btc-vision/transaction';
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
import { PointerStorageMap } from '../../../../../vm/evaluated/EvaluatedResult.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import {
    CallParams,
    SimulatedTransaction,
} from '../../../../json-rpc/types/interfaces/params/states/CallParams.js';
import {
    AccessList,
    AccessListItem,
    CallResult,
    ContractEvents,
} from '../../../../json-rpc/types/interfaces/results/states/CallResult.js';
import { ServerThread } from '../../../../ServerThread.js';
import { Route } from '../../../Route.js';
import { EventReceiptDataForAPI } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions';
import { OPNetConsensus } from '../../../../../poa/configurations/OPNetConsensus.js';
import { FastStringMap } from '../../../../../utils/fast/FastStringMap.js';

export class Call extends Route<Routes.CALL, JSONRpcMethods.CALL, CallResult | undefined> {
    private pendingRequests: number = 0;

    constructor() {
        super(Routes.CALL, RouteType.POST);
    }

    public static async requestThreadExecution(
        to: string,
        calldata: string,
        from?: string,
        blockNumber?: bigint,
        transaction?: SimulatedTransaction,
        accessList?: AccessList,
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
                    transaction,
                    accessList,
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

    public async getData(params: CallParams): Promise<CallResult | undefined> {
        this.incrementPendingRequests();

        try {
            if (!this.storage) {
                throw new Error('Storage not initialized');
            }

            const [to, calldata, from, blockNumber, transaction, accessList] =
                this.getDecodedParams(params);

            const res: CallRequestResponse = await Call.requestThreadExecution(
                to,
                calldata,
                from,
                blockNumber,
                this.verifyPartialTransaction(transaction),
                accessList as AccessList,
            );

            if (!res) {
                throw new Error(`Failed to execute the given calldata at the requested contract.`);
            }

            this.decrementPendingRequests();
            return this.convertDataToResult(res);
        } catch (e) {
            this.decrementPendingRequests();

            if (
                (e as Error).message.includes('mongo') ||
                (e as Error).message.includes('database')
            ) {
                throw `Something went wrong while simulating call (Database error)`;
            }

            throw `Something went wrong while simulating call (${e})`;
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
            const params = await this.getParams(req, res);
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

    protected async getParams(req: Request, res: Response): Promise<CallParams | undefined> {
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

        const transaction: Partial<SimulatedTransaction> | undefined = await req.json();
        if (transaction && (!('inputs' in transaction) || !('outputs' in transaction))) {
            throw new Error('Invalid transaction');
        }

        return {
            to,
            calldata: data,
            from,
            blockNumber,
            transaction,
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

    private convertEventToResult(
        events: FastStringMap<NetEvent[]> | Map<string, NetEvent[]> | undefined,
    ): ContractEvents {
        const contractEvents: ContractEvents = {};

        if (!events) {
            return contractEvents;
        }

        for (const [contract, contractEventsList] of events) {
            const contractEventsListResult: EventReceiptDataForAPI[] = [];

            for (const event of contractEventsList) {
                const eventResult: EventReceiptDataForAPI = {
                    contractAddress: contract,
                    type: event.type,
                    data: Buffer.from(event.data).toString('base64'),
                };

                contractEventsListResult.push(eventResult);
            }

            contractEvents[contract] = contractEventsListResult;
        }

        return contractEvents;
    }

    private getAccessList(
        changedStorage:
            | FastStringMap<PointerStorageMap>
            | Map<string, Map<bigint, bigint>>
            | undefined,
    ): AccessList {
        const accessList: AccessList = {};
        if (!changedStorage) {
            return accessList;
        }

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

    private verifyPartialTransaction(
        partial: Partial<SimulatedTransaction> | undefined,
    ): SimulatedTransaction | undefined {
        if (!partial) {
            return;
        }

        if (!('inputs' in partial) || !('outputs' in partial)) {
            throw new Error('Invalid transaction');
        }

        if (Array.isArray(partial.inputs) && Array.isArray(partial.outputs)) {
            if (
                partial.inputs.length > OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_INPUTS ||
                partial.outputs.length > OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_OUTPUTS
            ) {
                throw new Error('Too many inputs/outputs');
            }

            for (const input of partial.inputs) {
                if (typeof input !== 'object') {
                    throw new Error('Invalid transaction inputs/outputs');
                }

                if (!input.scriptSig) {
                    throw new Error('Missing scriptSig');
                }

                if (!input.txId) {
                    throw new Error('Missing txId');
                }

                if (!('outputIndex' in input)) {
                    throw new Error('Missing outputIndex');
                }

                if (typeof input.outputIndex !== 'number') {
                    throw new Error('Invalid outputIndex');
                }

                if (typeof input.txId !== 'string') {
                    throw new Error('Invalid txId');
                }

                if (typeof input.scriptSig !== 'string') {
                    throw new Error('Invalid scriptSig');
                }
            }

            for (const output of partial.outputs) {
                if (typeof output !== 'object') {
                    throw new Error('Invalid transaction inputs/outputs');
                }

                if (!('value' in output)) {
                    throw new Error('Missing value');
                }

                if (!output.to) {
                    throw new Error('Missing to');
                }

                if (!('index' in output)) {
                    throw new Error('Missing index');
                }

                if (typeof output.index !== 'number') {
                    throw new Error('Invalid index');
                }

                if (typeof output.value !== 'string') {
                    throw new Error('Invalid value');
                }

                if (typeof output.to !== 'string') {
                    throw new Error('Invalid to');
                }
            }
        } else {
            throw new Error('Invalid transaction inputs/outputs');
        }

        return partial as SimulatedTransaction;
    }

    private getDecodedParams(
        params: CallParams,
    ): [
        string,
        string,
        string | undefined,
        bigint | undefined,
        Partial<SimulatedTransaction> | undefined,
        Partial<AccessList> | undefined,
    ] {
        let address: string | undefined;
        let calldata: string | undefined;
        let from: string | undefined;
        let blockNumber: bigint | undefined;
        let transaction: Partial<SimulatedTransaction> | undefined;
        let accessList: Partial<AccessList> | undefined;

        if (Array.isArray(params)) {
            address = params.shift() as string | undefined;
            calldata = params.shift() as string | undefined;
            from = params.shift() as string | undefined;

            const temp: string | undefined = params.shift() as string | undefined;
            blockNumber = temp ? BigInt(temp) : undefined;

            transaction = params.shift() as Partial<SimulatedTransaction> | undefined;
            accessList = params.shift() as Partial<AccessList> | undefined;
        } else {
            address = params.to;
            calldata = params.calldata;
            from = params.from;
            blockNumber = params.blockNumber ? BigInt(params.blockNumber) : undefined;
            transaction = params.transaction;
            accessList = params.accessList;
        }

        if (!address) {
            throw new Error('Receiver address not provided.');
        }

        if (!AddressVerificator.detectAddressType(address, this.network)) {
            throw new Error(`Address ${address} is not a valid Bitcoin address.`);
        }

        if (!calldata || calldata.length < 1) throw new Error(`Invalid calldata specified.`);

        if (OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CALLDATA_SIZE_COMPRESSED < calldata.length) {
            throw new Error(`Calldata exceeds maximum size reached.`);
        }

        // Verify access list
        if (accessList) {
            if (Object.keys(accessList).length > 6) {
                throw new Error(`Can not provide access list for more than 6 contracts.`);
            }

            for (const contract in accessList) {
                if (!AddressVerificator.isValidPublicKey(contract, this.network)) {
                    throw new Error('Contract address must be a valid public key.');
                }

                const storage = accessList[contract];
                if (storage && Object.keys(storage).length > 200) {
                    throw new Error(`Storage exceeds maximum size reached.`);
                }

                for (const key in storage) {
                    if (key.length > 60) {
                        throw new Error(`Key exceeds maximum size reached.`);
                    }

                    if (storage[key].length > 60) {
                        throw new Error(`Value exceeds maximum size reached.`);
                    }
                }
            }
        }

        return [address, calldata, from, blockNumber, transaction, accessList];
    }
}
