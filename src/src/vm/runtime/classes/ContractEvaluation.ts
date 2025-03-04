import { ExecutionParameters } from '../types/InternalContractCallParameters.js';
import {
    Address,
    AddressMap,
    BinaryReader,
    BinaryWriter,
    DeterministicMap,
    MemorySlotData,
    MemorySlotPointer,
    NetEvent,
    PointerStorage,
} from '@btc-vision/transaction';
import {
    BlockchainStorageMap,
    EvaluatedEvents,
    EvaluatedResult,
    PointerStorageMap,
} from '../../evaluated/EvaluatedResult.js';
import { GasTracker } from '../GasTracker.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { StrippedTransactionOutput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { StrippedTransactionInput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import { FastBigIntMap } from '../../../utils/fast/FastBigintMap.js';
import { AccessList } from '../../../api/json-rpc/types/interfaces/results/states/CallResult.js';
import { Config } from '../../../config/Config.js';

export class ContractEvaluation implements ExecutionParameters {
    public readonly contractAddress: Address;
    public readonly contractAddressStr: string;

    public readonly calldata: Uint8Array;
    public readonly msgSender: Address;
    public readonly txOrigin: Address;

    public readonly blockNumber: bigint;
    public readonly blockMedian: bigint;

    public readonly externalCall: boolean;

    public modifiedStorage: BlockchainStorageMap | undefined;

    public events: EvaluatedEvents = new AddressMap();

    public result: Uint8Array | undefined;
    public readonly gasTracker: GasTracker;

    public contractDeployDepth: number;
    public callDepth: number;

    public readonly transactionId: Buffer;
    public readonly transactionHash: Buffer | null;

    public readonly storage: AddressMap<PointerStorage>;
    public readonly deployedContracts: ContractInformation[];

    public callStack: Address[];

    public isConstructor: boolean = false;

    public readonly inputs: StrippedTransactionInput[] = [];
    public readonly outputs: StrippedTransactionOutput[] = [];

    public serializedInputs: Uint8Array | undefined;
    public serializedOutputs: Uint8Array | undefined;

    public readonly accessList: AccessList | undefined;

    constructor(params: ExecutionParameters) {
        this.contractAddress = params.contractAddress;
        this.contractAddressStr = params.contractAddressStr;

        this.calldata = params.calldata;
        this.msgSender = params.msgSender;
        this.txOrigin = params.txOrigin;
        this.externalCall = params.externalCall;
        this.blockNumber = params.blockNumber;
        this.blockMedian = params.blockMedian;
        this.callDepth = params.callDepth;
        this.contractDeployDepth = params.contractDeployDepth;
        this.deployedContracts = params.deployedContracts || [];
        this.isConstructor = params.isConstructor || false;

        this.transactionId = params.transactionId || Buffer.alloc(32);
        this.transactionHash = params.transactionHash;

        this.gasTracker = new GasTracker(params.maxGas);
        this.gasTracker.gasUsed = params.gasUsed;

        this.callStack = params.callStack || [];
        this.callStack.push(this.contractAddress);

        this.storage = params.storage;

        this.inputs = params.inputs;
        this.outputs = params.outputs;

        this.serializedInputs = params.serializedInputs;
        this.serializedOutputs = params.serializedOutputs;

        this.accessList = params.accessList;
        this.parseAccessList();
    }

    public _totalEventSize: number = 0;

    public get totalEventSize(): number {
        return this._totalEventSize;
    }

    public set totalEventSize(size: number) {
        const newSize = this._totalEventSize + size;
        if (newSize > OPNetConsensus.consensus.TRANSACTIONS.EVENTS.MAXIMUM_TOTAL_EVENT_LENGTH) {
            throw new Error('OP_NET: Maximum total event length exceeded.');
        }

        this._totalEventSize = newSize;
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

    public getSerializeInputUTXOs(): Buffer {
        if (!this.serializedInputs) {
            this.serializedInputs = this.computeInputUTXOs();
        }

        return Buffer.from(this.serializedInputs);
    }

    public getSerializeOutputUTXOs(): Buffer {
        if (!this.serializedOutputs) {
            this.serializedOutputs = this.computeOutputUTXOs();
        }

        return Buffer.from(this.serializedOutputs);
    }

    public setGas(gas: bigint): void {
        this.gasTracker.setGas(gas);
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
        const current: PointerStorage =
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

    public emitEvent(event: NetEvent): void {
        if (!this.events) throw new Error('Events not set');

        this.enforceEventLimits(event);

        const current = this.events.get(this.contractAddress) || [];
        current.push(event);

        this.events.set(this.contractAddress, current);
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

        if (extern.contractAddress.equals(this.contractAddress)) {
            throw new Error('Cannot call self');
        }

        this.callStack = extern.callStack;
        if (OPNetConsensus.consensus.TRANSACTIONS.REENTRANCY_GUARD) {
            this.checkReentrancy(extern.callStack);
        }

        this.callDepth = extern.callDepth;
        this.contractDeployDepth = extern.contractDeployDepth;

        if (this.callDepth > OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_CALL_DEPTH) {
            throw new Error(`Call depth exceeded`);
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
            ? new AddressMap()
            : this.modifiedStorage;

        const events: AddressMap<NetEvent[]> = this.revert ? new AddressMap() : this.events;
        const result = this.revert ? new Uint8Array(1) : this.result;
        const deployedContracts = this.revert ? [] : this.deployedContracts;

        const resp: EvaluatedResult = {
            changedStorage: modifiedStorage,
            result: result,
            events: events,
            gasUsed: this.gasUsed,
            deployedContracts: deployedContracts,
        };

        if (this.revert) {
            resp.revert = this.revert.toString();
        }

        return resp;
    }

    public addContractInformation(contract: ContractInformation): void {
        this.deployedContracts.push(contract);
    }

    private enforceEventLimits(event: NetEvent): void {
        // Enforce event limits
        if (event.data.length > OPNetConsensus.consensus.TRANSACTIONS.EVENTS.MAXIMUM_EVENT_LENGTH) {
            throw new Error('OP_NET: Maximum event length exceeded.');
        }

        // Enforce total event size limit
        this.totalEventSize += event.data.length;

        // Enforce event type length limit
        if (
            event.type.length >
            OPNetConsensus.consensus.TRANSACTIONS.EVENTS.MAXIMUM_EVENT_NAME_LENGTH
        ) {
            throw new Error('OP_NET: Maximum event type length exceeded.');
        }
    }

    private computeInputUTXOs(): Uint8Array {
        const maxInputs = Math.min(
            OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_INPUTS,
            this.inputs.length,
        );

        const writer = new BinaryWriter();
        writer.writeU8(maxInputs);

        for (let i = 0; i < maxInputs; i++) {
            const input = this.inputs[i];
            writer.writeBytes(input.txId);
            writer.writeU8(input.outputIndex);
            writer.writeBytesWithLength(input.scriptSig);
        }

        return writer.getBuffer();
    }

    private computeOutputUTXOs(): Uint8Array {
        const maxOutputs = Math.min(
            OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_OUTPUTS,
            this.outputs.length,
        );

        const writer = new BinaryWriter();
        writer.writeU8(maxOutputs);

        for (let i = 0; i < maxOutputs; i++) {
            const output = this.outputs[i];
            writer.writeU8(output.index);
            writer.writeStringWithLength(output.to);
            writer.writeU64(output.value);
        }

        return writer.getBuffer();
    }

    private checkReentrancy(callStack: Address[]): void {
        if (callStack.includes(this.contractAddress)) {
            throw new Error('OP_NET: REENTRANCY');
        }
    }

    private setModifiedStorage(): void {
        this.mergeStorage(this.storage);
    }

    private mergeEvents(events: EvaluatedEvents): void {
        if (!this.events) {
            this.events = new AddressMap();
        }

        for (const [key, value] of events) {
            const current = this.events.get(key) || [];
            for (const v of value) {
                this.enforceEventLimits(v);

                current.push(v);
            }

            this.events.set(key, current);
        }
    }

    private parseAccessList(): void {
        // add all items from access list to storage

        try {
            if (!this.accessList) {
                return;
            }

            for (const [address, storageKeys] of Object.entries(this.accessList)) {
                const contract = Address.fromString(address);
                const current: PointerStorage =
                    this.storage.get(contract) ||
                    new DeterministicMap((a: bigint, b: bigint) => {
                        return BinaryReader.bigintCompare(a, b);
                    });

                for (const [key, value] of Object.entries(storageKeys)) {
                    const bigIntBuf = Buffer.from(key, 'base64');
                    const valueBuf = Buffer.from(value, 'base64');

                    if (bigIntBuf.length !== 32 || valueBuf.length !== 32) {
                        throw new Error(`Invalid access list key or value.`);
                    }

                    const pointerKey = BigInt('0x' + bigIntBuf.toString('hex'));
                    const pointerValue = BigInt('0x' + valueBuf.toString('hex'));
                    current.set(pointerKey, pointerValue);
                }

                this.storage.set(contract, current);
            }
        } catch (e) {
            if (Config.DEV_MODE) {
                console.log(`Error parsing access list: ${e}`);
            }

            throw new Error(`Can not parse access list.`);
        }
    }

    private mergeStorage(storage: BlockchainStorageMap | AddressMap<PointerStorage>): void {
        if (!this.modifiedStorage) {
            this.modifiedStorage = new AddressMap();
        }

        for (const [key, value] of storage) {
            const current: PointerStorageMap = this.modifiedStorage.get(key) || new FastBigIntMap();

            for (const [k, v] of value) {
                current.set(k, v);
            }

            this.modifiedStorage.set(key, current);
        }
    }
}
