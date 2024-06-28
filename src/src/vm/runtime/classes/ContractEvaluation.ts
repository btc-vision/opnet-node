import { IEvaluationParameters } from '../types/InternalContractCallParameters.js';
import {
    Address,
    BinaryReader,
    BlockchainStorage,
    DeterministicMap,
    NetEvent,
} from '@btc-vision/bsi-binary';
import {
    BlockchainStorageMap,
    EvaluatedEvents,
    EvaluatedResult,
    PointerStorageMap,
} from '../../evaluated/EvaluatedResult.js';
import { ExternalCallsResult } from '../types/ExternalCall.js';
import { MapConverter } from '../MapConverter.js';
import { GasTracker } from '../GasTracker.js';
import { MemorySlotData, MemorySlotPointer } from '@btc-vision/bsi-binary/src/buffer/types/math.js';

export class ContractEvaluation implements IEvaluationParameters {
    public readonly contractAddress: Address;
    public readonly isView: boolean;
    public readonly abi: number;
    public readonly calldata: Uint8Array;
    public readonly caller: Address;
    public readonly callee: Address;
    public canWrite: boolean;

    public readonly blockNumber: bigint;
    public readonly blockMedian: bigint;

    public readonly externalCall: boolean;

    public modifiedStorage: BlockchainStorageMap | undefined;

    public events: EvaluatedEvents = new Map();

    public result: Uint8Array | undefined;
    public readonly gasTracker: GasTracker = new GasTracker();

    public readonly storage: BlockchainStorage = new DeterministicMap(BinaryReader.stringCompare);

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
        this.blockMedian = params.blockMedian;

        this.gasTracker.maxGas = params.maxGas;
        this.gasTracker.gasUsed = params.gasUsed;
    }

    public get maxGas(): bigint {
        return this.gasTracker.maxGas;
    }

    private _revert: Error | string | undefined;

    public get revert(): Error | string | undefined {
        return this._revert;
    }

    public set revert(error: Error | string) {
        this._revert = error;
    }

    public get gasUsed(): bigint {
        return this.gasTracker.gasUsed;
    }

    public setStorage(pointer: MemorySlotPointer, value: MemorySlotData<bigint>): void {
        const current =
            this.storage.get(this.contractAddress) ||
            new DeterministicMap(BinaryReader.bigintCompare);

        current.set(pointer, value);

        this.storage.set(this.contractAddress, current);
    }

    public onGasUsed: (gas: bigint, method: string) => void = (gas: bigint, method: string) => {
        //console.log(`Gas used: ${gas} for method ${method}`);

        this.gasTracker.setGas(gas);
    };

    public setCanWrite(canWrite: boolean): void {
        this.canWrite = canWrite;
    }

    public setEvent(contract: Address, events: NetEvent[]) {
        if (!this.events) throw new Error('Events not set');

        this.events.set(contract, events);
    }

    public setResult(result: Uint8Array): void {
        this.result = result;

        this.setModifiedStorage();
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
            reverted: !!this.revert,
        };
    }

    private setModifiedStorage(): void {
        this.modifiedStorage =
            MapConverter.convertDeterministicBlockchainStorageMapToBlockchainStorage(this.storage);

        if (this.modifiedStorage.size > 1) {
            throw new Error(`execution reverted (storage is too big)`);
        }
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

    private mergeStorage(storage: BlockchainStorageMap): void {
        if (!this.modifiedStorage) {
            throw new Error('Modified storage not set');
        }

        for (const [key, value] of storage) {
            const current: PointerStorageMap = this.modifiedStorage.get(key) || new Map();

            for (const [k, v] of value) {
                current.set(k, v);
            }

            this.modifiedStorage.set(key, current);
        }
    }
}
