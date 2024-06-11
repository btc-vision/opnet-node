import { IEvaluationParameters } from '../types/InternalContractCallParameters.js';
import { Address, BlockchainStorage, NetEvent } from '@btc-vision/bsi-binary';
import { EvaluatedEvents, EvaluatedResult } from '../../evaluated/EvaluatedResult.js';
import { ExternalCallsResult } from '../types/ExternalCall.js';
import { GasTracker } from '../GasTracker.js';

export class ContractEvaluation implements IEvaluationParameters {
    public readonly contractAddress: Address;
    public readonly isView: boolean;
    public readonly abi: number;
    public readonly calldata: Uint8Array;
    public readonly caller: Address;
    public readonly callee: Address;
    public readonly canWrite: boolean;

    public readonly externalCall: boolean;

    public initialStorage: BlockchainStorage | undefined;
    public modifiedStorage: BlockchainStorage | undefined;

    public events: EvaluatedEvents | undefined;
    public sameStorage: boolean = false;

    public result: Uint8Array | undefined;

    public gasUsed: bigint = 0;
    public tries: number = 0;

    constructor(params: IEvaluationParameters) {
        this.contractAddress = params.contractAddress;
        this.isView = params.isView;
        this.abi = params.abi;
        this.calldata = params.calldata;
        this.caller = params.caller;
        this.callee = params.callee;
        this.canWrite = params.canWrite;
        this.externalCall = params.externalCall;
    }

    public incrementTries(): void {
        this.tries++;
    }

    public setInitialStorage(storage: BlockchainStorage): void {
        this.initialStorage = storage;
    }

    public setEvents(events: EvaluatedEvents): void {
        this.events = events;
    }

    public setEvent(contract: Address, events: NetEvent[]) {
        if (!this.events) throw new Error('Events not set');

        this.events.set(contract, events);
    }

    public setSameStorage(sameStorage: boolean) {
        this.sameStorage = sameStorage;
    }

    public setResult(result: Uint8Array): void {
        this.result = result;
    }

    public setModifiedStorage(storage: BlockchainStorage): void {
        this.modifiedStorage = storage;
    }

    public setGasUsed(gasUsed: bigint): void {
        this.gasUsed = GasTracker.round(gasUsed);
    }

    public processExternalCalls(extern: ExternalCallsResult): void {
        console.log('Processing external calls', extern);
    }

    public getEvaluationResult(): EvaluatedResult {
        if (!this.result) throw new Error('Result not set');
        if (!this.events) throw new Error('Events not set');
        if (!this.modifiedStorage) throw new Error('Modified storage not set');

        return {
            changedStorage: this.modifiedStorage,
            result: this.result,
            events: this.events,
            gasUsed: this.gasUsed,
        };
    }
}
