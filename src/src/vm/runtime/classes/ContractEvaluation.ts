import { IEvaluationParameters } from '../types/InternalContractCallParameters.js';
import { Address, BlockchainStorage, NetEvent } from '@btc-vision/bsi-binary';
import { EvaluatedEvents, EvaluatedResult } from '../../evaluated/EvaluatedResult.js';
import { ExternalCallsResult } from '../types/ExternalCall.js';

export class ContractEvaluation implements IEvaluationParameters {
    public readonly contractAddress: Address;
    public readonly isView: boolean;
    public readonly abi: number;
    public readonly calldata: Uint8Array;
    public readonly caller: Address;
    public readonly callee: Address;
    public readonly canWrite: boolean;

    public readonly blockNumber: bigint;

    public readonly externalCall: boolean;

    public initialStorage: BlockchainStorage | undefined;
    public modifiedStorage: BlockchainStorage | undefined;

    public events: EvaluatedEvents | undefined;
    public sameStorage: boolean = false;

    public result: Uint8Array | undefined;

    public gasUsed: bigint = 0n;
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
        this.blockNumber = params.blockNumber;
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

        if (this.modifiedStorage.size > 1) {
            throw new Error(`execution reverted (storage is too big)`);
        }
    }

    public setGasUsed(gasUsed: bigint): void {
        this.gasUsed = gasUsed; //GasTracker.round(gasUsed);
    }

    public processExternalCalls(extern: ExternalCallsResult): void {
        // we must merge the storage of the external calls
        for (const [contract, call] of extern) {
            if (contract === this.contractAddress) {
                throw new Error('Cannot call self');
            }

            for (let i = 0; i < call.length; i++) {
                const c = call[i];
                if (!c) {
                    throw new Error('External call not found');
                }

                if (!c.canWrite) {
                    continue;
                }

                const storage = c.modifiedStorage;
                if (!storage) {
                    throw new Error('Storage not set');
                }

                this.mergeStorage(storage);

                const events = c.events;
                if (events) {
                    this.mergeEvents(events);
                }
            }
        }
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

    private mergeEvents(events: EvaluatedEvents): void {
        if (!this.events) {
            this.events = new Map();
        }

        for (const [key, value] of events) {
            const current = this.events.get(key) || [];
            for (const v of value) {
                current.push(v);
            }

            this.events.set(key, current);
        }
    }

    private mergeStorage(storage: BlockchainStorage): void {
        if (!this.modifiedStorage) {
            throw new Error('Modified storage not set');
        }

        for (const [key, value] of storage) {
            const current = this.modifiedStorage.get(key) || new Map();
            for (const [k, v] of value) {
                current.set(k, v);
            }

            this.modifiedStorage.set(key, current);
        }
    }
}
