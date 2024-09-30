import { ExecutionParameters } from '../types/InternalContractCallParameters.js';
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
import { MapConverter } from '../MapConverter.js';
import { GasTracker } from '../GasTracker.js';
import { MemorySlotData, MemorySlotPointer } from '@btc-vision/bsi-binary/src/buffer/types/math.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';

export class ContractEvaluation implements ExecutionParameters {
    public readonly contractAddress: Address;
    public readonly selector: number;

    public readonly calldata: Uint8Array;
    public readonly msgSender: Address;
    public readonly txOrigin: Address;

    public readonly blockNumber: bigint;
    public readonly blockMedian: bigint;

    public readonly externalCall: boolean;

    public modifiedStorage: BlockchainStorageMap | undefined;

    public events: EvaluatedEvents = new Map();

    public result: Uint8Array | undefined;
    public readonly gasTracker: GasTracker = new GasTracker(
        OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS,
    );

    public contractDeployDepth: number;
    public callDepth: number;

    public readonly transactionId: string | null;
    public readonly transactionHash: string | null;

    public readonly storage: BlockchainStorage;
    public readonly deployedContracts: ContractInformation[] = [];

    public callStack: Address[];

    constructor(params: ExecutionParameters) {
        this.contractAddress = params.contractAddress;
        this.selector = params.selector;
        this.calldata = params.calldata;
        this.msgSender = params.msgSender;
        this.txOrigin = params.txOrigin;
        this.externalCall = params.externalCall;
        this.blockNumber = params.blockNumber;
        this.blockMedian = params.blockMedian;
        this.callDepth = params.callDepth;
        this.contractDeployDepth = params.contractDeployDepth;

        this.transactionId = params.transactionId;
        this.transactionHash = params.transactionHash;

        this.gasTracker.maxGas = params.maxGas;
        this.gasTracker.gasUsed = params.gasUsed;

        this.callStack = params.callStack || [];
        this.callStack.push(this.contractAddress);

        this.storage = params.storage;
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

    public incrementContractDeployDepth(): void {
        if (
            this.contractDeployDepth >=
            OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_DEPLOYMENT_DEPTH
        ) {
            throw new Error('Contract deployment depth exceeded');
        }

        this.contractDeployDepth++;
    }

    public incrementCallDepth(): void {
        if (this.callDepth >= OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_CALL_DEPTH) {
            throw new Error('Call depth exceeded');
        }

        this.callDepth++;
    }

    public setStorage(pointer: MemorySlotPointer, value: MemorySlotData<bigint>): void {
        const current =
            this.storage.get(this.contractAddress) ||
            new DeterministicMap((a: bigint, b: bigint) => {
                return BinaryReader.bigintCompare(a, b);
            });

        current.set(pointer, value);

        this.storage.set(this.contractAddress, current);
    }

    public getStorage(pointer: MemorySlotPointer): MemorySlotData<bigint> | undefined {
        const current = this.storage.get(this.contractAddress);
        if (!current) {
            return;
        }

        return current.get(pointer);
    }

    public onGasUsed: (gas: bigint, method: string) => void = (gas: bigint, _method: string) => {
        this.gasTracker.setGas(gas);
    };

    public setEvent(contract: Address, events: NetEvent[]) {
        if (!this.events) throw new Error('Events not set');

        this.events.set(contract, events);
    }

    public setResult(result: Uint8Array): void {
        this.result = result;

        this.setModifiedStorage();
    }

    public merge(extern: ContractEvaluation): void {
        // we must merge the storage of the external calls
        if (extern.revert) {
            this.revert = extern.revert;

            throw new Error('execution reverted (merge)');
        }

        if (extern.contractAddress === this.contractAddress) {
            throw new Error('Cannot call self');
        }

        //if (!this.canWrite && extern.canWrite) {
        //    throw new Error(`OPNET: READONLY_CALLED_WRITE`);
        //}

        this.callStack = extern.callStack;
        this.checkReentrancy(extern.callStack);

        this.callDepth = extern.callDepth;
        this.contractDeployDepth = extern.contractDeployDepth;

        if (this.callDepth > OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_CALL_DEPTH) {
            throw new Error('Call depth exceeded');
        }

        if (
            this.contractDeployDepth >
            OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_DEPLOYMENT_DEPTH
        ) {
            throw new Error('Contract deployment depth exceeded');
        }

        if (extern.modifiedStorage) {
            this.mergeStorage(extern.modifiedStorage);
        }

        if (extern.events) {
            this.mergeEvents(extern.events);
        }

        if (extern.deployedContracts && !(extern.revert || this.revert)) {
            this.deployedContracts.push(...extern.deployedContracts);
        }

        this.gasTracker.gasUsed = extern.gasUsed;
    }

    public getEvaluationResult(): EvaluatedResult {
        const modifiedStorage: BlockchainStorageMap | undefined = this.revert
            ? new Map()
            : this.modifiedStorage;

        const events = this.revert ? new Map() : this.events;
        const result = this.revert ? new Uint8Array(1) : this.result;
        const deployedContracts = this.revert ? [] : this.deployedContracts;

        return {
            changedStorage: modifiedStorage,
            result: result,
            events: events,
            gasUsed: this.gasUsed,
            revert: this.revert,
            deployedContracts: deployedContracts,
        };
    }

    public addContractInformation(contract: ContractInformation): void {
        this.deployedContracts.push(contract);
    }

    private checkReentrancy(callStack: Address[]): void {
        if (callStack.includes(this.contractAddress)) {
            throw new Error('OPNET: REENTRANCY');
        }
    }

    private setModifiedStorage(): void {
        const modifiedStorage =
            MapConverter.convertDeterministicBlockchainStorageMapToBlockchainStorage(this.storage);

        this.mergeStorage(modifiedStorage);
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
            this.modifiedStorage = new Map();
        }

        for (const [key, value] of storage) {
            const current: PointerStorageMap =
                this.modifiedStorage.get(key) || (new Map() as PointerStorageMap);

            for (const [k, v] of value) {
                current.set(k, v);
            }

            this.modifiedStorage.set(key, current);
        }
    }
}
