import { AddressVerificator, BufferHelper, NetEvent } from '@btc-vision/transaction';
import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from '@btc-vision/hyper-express/types/components/middleware/MiddlewareNext.js';
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
    LoadedStorageList,
} from '../../../../json-rpc/types/interfaces/results/states/CallResult.js';
import { ServerThread } from '../../../../ServerThread.js';
import { Route } from '../../../Route.js';
import { EventReceiptDataForAPI } from '../../../../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions';
import { OPNetConsensus } from '../../../../../poc/configurations/OPNetConsensus.js';
import { FastStringMap } from '../../../../../utils/fast/FastStringMap.js';
import {
    TransactionInputFlags,
    TransactionOutputFlags,
} from '../../../../../poc/configurations/types/IOPNetConsensus.js';
import { StrippedTransactionInputAPI } from '../../../../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import { StrippedTransactionOutputAPI } from '../../../../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';

export class Call extends Route<Routes.CALL, JSONRpcMethods.CALL, CallResult | undefined> {
    private pendingRequests: number = 0;

    constructor() {
        super(Routes.CALL, RouteType.GET);
    }

    public static async requestThreadExecution(
        to: string,
        calldata: string,
        from?: string,
        fromLegacy?: string,
        blockNumber?: bigint,
        transaction?: SimulatedTransaction,
        accessList?: AccessList,
        preloadStorage?: LoadedStorageList,
    ): Promise<CallRequestResponse> {
        const simulationMsg: RPCMessage<BitcoinRPCThreadMessageType.CALL> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.CALL,
                data: {
                    to: to,
                    calldata: calldata,
                    from: from,
                    fromLegacy: fromLegacy,
                    blockNumber: blockNumber,
                    transaction,
                    accessList,
                    preloadStorage,
                },
            } as CallRequest,
        };

        const simulation: CallRequestResponse | null = (await ServerThread.sendMessageToThread(
            ThreadTypes.RPC,
            simulationMsg,
            false,
        )) as CallRequestResponse | null;

        if (!simulation) {
            throw new Error(`Failed to execute the contract. No response from thread.`);
        }

        return simulation;
    }

    public async getData(params: CallParams): Promise<CallResult | undefined> {
        this.incrementPendingRequests();

        try {
            if (!this.storage) {
                throw new Error('Storage not initialized');
            }

            const [
                to,
                calldata,
                from,
                fromLegacy,
                blockNumber,
                transaction,
                accessList,
                preloadStorage,
            ] = this.getDecodedParams(params);

            const res: CallRequestResponse = await Call.requestThreadExecution(
                to,
                calldata,
                from,
                fromLegacy,
                blockNumber,
                this.verifyPartialTransaction(transaction),
                accessList as AccessList,
                preloadStorage as LoadedStorageList,
            );

            return this.convertDataToResult(res);
        } catch (e) {
            if (
                (e as Error).message.includes('mongo') ||
                (e as Error).message.includes('database')
            ) {
                throw `Something went wrong while simulating call (Database error)`;
            }

            if (Config.DEV_MODE) {
                this.error(`Something went wrong while simulating call (${(e as Error).stack})`);
            }

            throw `Something went wrong while simulating call (${e})`;
        } finally {
            this.decrementPendingRequests();
        }
    }

    public async getDataRPC(params: CallParams): Promise<CallResult | undefined> {
        const data = await this.getData(params);
        if (!data)
            throw new Error(`Could not execute the given calldata at the requested contract.`);

        return data;
    }

    protected incrementPendingRequests(): void {
        this.pendingRequests++;
        if (this.pendingRequests > Config.API.MAXIMUM_PENDING_CALL_REQUESTS) {
            this.pendingRequests--;
            throw new Error(`Too many pending call requests.`);
        }
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
                return; // getParams already sent error response
            }

            const data = await this.getData(params);
            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, {
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
        const fromLegacy = req.query.fromLegacy as string;
        const blockNumber = req.query.blockNumber as string;

        if (!to || to.length < 50) {
            this.safeJson(res, 400, { error: 'Invalid address. Address must be P2TR (taproot).' });
            return;
        }

        if (!data || data.length < 4) {
            this.safeJson(res, 400, { error: 'Invalid calldata.' });
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
            fromLegacy,
            blockNumber,
            transaction,
        };
    }

    private convertDataToResult(data: CallRequestResponse): CallResult {
        if ('error' in data) {
            return data;
        }

        const result: string = data.result ? Buffer.from(data.result).toString('base64') : '';
        const revert: string = data.revert ? Buffer.from(data.revert).toString('base64') : '';

        const accessList: AccessList = data.changedStorage
            ? this.getAccessList(data.changedStorage)
            : {};

        const loadedStorage = data.loadedStorage;

        const response: CallResult = {
            result: result,
            events: this.convertEventToResult(data.events),
            accessList,
            loadedStorage,
            estimatedGas: '0x' + (data.gasUsed || 0).toString(16),
            estimatedSpecialGas: '0x' + (data.specialGasUsed || 0).toString(16),
        };

        if (data.revert) {
            response.revert = revert;
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

        const finalInputs: StrippedTransactionInputAPI[] = [];
        const finalOutput: StrippedTransactionOutputAPI[] = [];

        if (Array.isArray(partial.inputs) && Array.isArray(partial.outputs)) {
            if (
                partial.inputs.length > OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_INPUTS ||
                partial.outputs.length > OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_OUTPUTS
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

                if (input.witnesses) {
                    if (!Array.isArray(input.witnesses)) {
                        throw new Error('Invalid witnesses');
                    }

                    if (input.witnesses.length > 30) {
                        throw new Error('Too many witnesses');
                    }

                    if ((input.flags & TransactionInputFlags.hasWitnesses) === 0) {
                        throw new Error('Missing witnesses flag. Is this an error?');
                    }

                    for (const witness of input.witnesses) {
                        if (typeof witness !== 'string') {
                            throw new Error('Invalid witness');
                        }
                    }
                }

                if (input.coinbase && typeof input.coinbase !== 'string') {
                    if ((input.flags & TransactionInputFlags.hasCoinbase) === 0) {
                        throw new Error('Missing coinbase flag. Is this an error?');
                    }

                    throw new Error('Invalid coinbase script');
                }

                if (typeof input.flags !== 'undefined') {
                    if (typeof input.flags !== 'number') {
                        throw new Error('Field flags must be a number');
                    }
                }

                finalInputs.push({
                    flags: input.flags || 0,
                    scriptSig: input.scriptSig,
                    txId: input.txId,
                    outputIndex: input.outputIndex,
                    coinbase: input.coinbase,
                    witnesses: input.witnesses,
                } as StrippedTransactionInputAPI);
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

                if (output.scriptPubKey && typeof output.scriptPubKey !== 'string') {
                    throw new Error('Invalid scriptPubKey');
                }

                if (typeof output.flags !== 'undefined') {
                    if (typeof output.flags !== 'number') {
                        throw new Error('Invalid flags');
                    }

                    const hasOPReturn: boolean =
                        (output.flags & TransactionOutputFlags.OP_RETURN) !== 0;

                    const hasScriptPubKey: boolean =
                        (output.flags & TransactionOutputFlags.hasScriptPubKey) !== 0;

                    const hasTo: boolean = (output.flags & TransactionOutputFlags.hasTo) !== 0;

                    // verify op_return
                    if (hasOPReturn) {
                        if (!hasScriptPubKey) {
                            throw new Error(
                                'Flag error: OP_RETURN and hasScriptPubKey are mutually inclusive',
                            );
                        }

                        if (hasTo) {
                            throw new Error(
                                'Flag error: OP_RETURN and hasTo are mutually exclusive',
                            );
                        }

                        if (!output.scriptPubKey) {
                            throw new Error('Missing scriptPubKey for OP_RETURN');
                        }

                        if (output.value !== '0') {
                            throw new Error('OP_RETURN value must be 0');
                        }
                    }

                    // Verify hasTo
                    if (hasTo) {
                        if (!output.to) {
                            throw new Error('Flag error: hasTo is set but to is missing');
                        }

                        if (hasScriptPubKey) {
                            throw new Error(
                                'Flag error: hasTo and hasScriptPubKey are mutually exclusive',
                            );
                        }

                        if (output.to.startsWith('0x')) {
                            throw new Error(
                                'Flag error: public keys outputs should be scriptPubKey and not to.',
                            );
                        }
                    } else if (hasScriptPubKey) {
                        if (!output.scriptPubKey) {
                            throw new Error(
                                'Flag error: hasScriptPubKey is set but scriptPubKey is missing',
                            );
                        }

                        if (hasTo) {
                            throw new Error(
                                'Flag error: hasTo and hasScriptPubKey are mutually exclusive',
                            );
                        }
                    } else {
                        throw new Error(
                            `Invalid flags for output ${output.index}. Please upgrade your opnet library.`,
                        );
                    }
                } else if (typeof output.to !== 'string') {
                    throw new Error('Invalid to. Must be a string.');
                }

                finalOutput.push({
                    index: output.index,
                    flags: output.flags,
                    scriptPubKey: output.scriptPubKey,
                    to: output.to,
                    value: output.value,
                } as StrippedTransactionOutputAPI);
            }
        } else {
            throw new Error('Invalid transaction inputs/outputs');
        }

        return {
            inputs: finalInputs,
            outputs: finalOutput,
        } as SimulatedTransaction;
    }

    private getDecodedParams(
        params: CallParams,
    ): [
        string,
        string,
        string | undefined,
        string | undefined,
        bigint | undefined,
        Partial<SimulatedTransaction> | undefined,
        Partial<AccessList> | undefined,
        Partial<LoadedStorageList> | undefined,
    ] {
        let address: string | undefined;
        let calldata: string | undefined;
        let from: string | undefined;
        let fromLegacy: string | undefined;
        let blockNumber: bigint | undefined;
        let transaction: Partial<SimulatedTransaction> | undefined;
        let accessList: Partial<AccessList> | undefined;
        let preloadStorage: Partial<LoadedStorageList> | undefined;

        if (Array.isArray(params)) {
            address = params.shift() as string | undefined;
            calldata = params.shift() as string | undefined;
            from = params.shift() as string | undefined;
            fromLegacy = params.shift() as string | undefined;

            const temp: string | undefined = params.shift() as string | undefined;
            if (temp && typeof temp !== 'string') {
                throw new Error('Invalid block number');
            }

            try {
                blockNumber = temp ? BigInt(temp) : undefined;
            } catch {
                throw new Error(`Invalid block number ${temp}`);
            }

            transaction = params.shift() as Partial<SimulatedTransaction> | undefined;
            accessList = params.shift() as Partial<AccessList> | undefined;
            preloadStorage = params.shift() as Partial<LoadedStorageList> | undefined;
        } else {
            address = params.to;
            calldata = params.calldata;
            from = params.from;
            fromLegacy = params.fromLegacy;
            blockNumber = params.blockNumber ? BigInt(params.blockNumber) : undefined;
            transaction = params.transaction;
            accessList = params.accessList;
            preloadStorage = params.preloadStorage;
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

        if (preloadStorage) {
            if (Object.keys(preloadStorage).length > 6) {
                throw new Error(`Can not provide preload storage for more than 6 contracts.`);
            }

            for (const contract in preloadStorage) {
                if (!AddressVerificator.isValidPublicKey(contract, this.network)) {
                    throw new Error('Contract address must be a valid public key.');
                }

                const storage = preloadStorage[contract];
                if (storage && storage.length > 20_000) {
                    throw new Error(`Storage exceeds maximum size reached.`);
                }

                if (!storage) {
                    continue;
                }

                for (let i = 0; i < storage.length; i++) {
                    const key = storage[i];

                    if (key.length > 60) {
                        throw new Error(`Key exceeds maximum size reached.`);
                    }
                }
            }
        }

        return [
            address,
            calldata,
            from,
            fromLegacy,
            blockNumber,
            transaction,
            accessList,
            preloadStorage,
        ];
    }
}
