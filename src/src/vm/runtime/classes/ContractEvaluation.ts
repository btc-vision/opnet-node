import { ExecutionParameters } from '../types/InternalContractCallParameters.js';
import {
    Address,
    AddressMap,
    BinaryReader,
    BinaryWriter,
    BufferHelper,
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
import { ProvenPointers } from '../../storage/types/MemoryValue.js';
import { AddressStack } from './AddressStack.js';
import { RustContract } from '../../isolated/RustContract.js';
import {
    TransactionInputFlags,
    TransactionOutputFlags,
} from '../../../poa/configurations/types/IOPNetConsensus.js';

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

    public memoryPagesUsed: bigint;
    public events: EvaluatedEvents = new AddressMap();

    public result: Uint8Array | undefined;
    public contractDeployDepth: number;

    public readonly blockHash: Buffer;
    public readonly transactionId: Buffer;
    public readonly transactionHash: Buffer;

    public readonly gasTracker: GasTracker;

    public readonly storage: AddressMap<PointerStorage>;
    public readonly preloadStorage: AddressMap<PointerStorage>;
    public readonly deployedContracts: AddressMap<ContractInformation>;
    public readonly touchedAddresses: AddressMap<boolean>;

    public callStack: AddressStack;
    public isDeployment: boolean = false;

    public readonly inputs: StrippedTransactionInput[] = [];
    public readonly outputs: StrippedTransactionOutput[] = [];

    public serializedInputs: Uint8Array | undefined;
    public serializedOutputs: Uint8Array | undefined;

    public readonly accessList: AccessList | undefined;
    public readonly preloadStorageList: AddressMap<Uint8Array[]> | undefined;

    private _totalEventSize: number = 0;

    constructor(params: ExecutionParameters) {
        this.contractAddress = params.contractAddress;
        this.contractAddressStr = params.contractAddressStr;

        this.calldata = params.calldata;
        this.msgSender = params.msgSender;
        this.txOrigin = params.txOrigin;
        this.externalCall = params.externalCall;
        this.blockNumber = params.blockNumber;
        this.blockMedian = params.blockMedian;
        this.deployedContracts = params.deployedContracts || new AddressMap();
        this.isDeployment = params.isDeployment || false;
        this.memoryPagesUsed = params.memoryPagesUsed || 0n;

        this.contractDeployDepth = params.contractDeployDepth || 0;

        if (this.isDeployment) {
            this.incrementContractDeployDepth();
        }

        this.blockHash = params.blockHash;
        this.transactionId = params.transactionId;
        this.transactionHash = params.transactionHash;
        this.gasTracker = params.gasTracker;

        // Push the contract address to the call stack
        this.callStack = params.callStack || new AddressStack();
        this.callStack.push(this.contractAddress);

        this.storage = params.storage;
        this.preloadStorage = params.preloadStorage;

        this.inputs = params.inputs;
        this.outputs = params.outputs;

        this.serializedInputs = params.serializedInputs;
        this.serializedOutputs = params.serializedOutputs;

        this.accessList = params.accessList;
        this.preloadStorageList = params.preloadStorageList;

        // Mark the contract address as touched
        this.touchedAddresses = params.touchedAddresses || new AddressMap();
        this.touchedAddresses.set(this.contractAddress, true);

        this.parseAccessList();
    }

    public get maxGas(): bigint {
        return this.gasTracker.maxGas;
    }

    public _revert: Uint8Array | undefined;

    public get revert(): Uint8Array | undefined {
        return this._revert;
    }

    public set revert(error: Error | string) {
        this._revert = RustContract.getErrorAsBuffer(error);

        if (this._revert.byteLength > 4096) {
            this._revert = RustContract.getErrorAsBuffer('OP_NET: Revert error too long.');
        }
    }

    public get gasUsed(): bigint {
        return this.gasTracker.gasUsed;
    }

    public touchAddress(address: Address, isContract: boolean): void {
        this.touchedAddresses.set(address, isContract);
    }

    public touchedAddress(address: Address): boolean | undefined {
        return this.touchedAddresses.get(address);
    }

    public getSerializeInputUTXOs(): Buffer {
        if (!this.serializedInputs) {
            this.serializedInputs = this.computeInputUTXOs();
        }

        return Buffer.copyBytesFrom(this.serializedInputs);
    }

    public getSerializeOutputUTXOs(): Buffer {
        if (!this.serializedOutputs) {
            this.serializedOutputs = this.computeOutputUTXOs();
        }

        return Buffer.copyBytesFrom(this.serializedOutputs);
    }

    public setGasUsed(gas: bigint): void {
        this.gasTracker.setGasUsed(gas);
    }

    public incrementContractDeployDepth(): void {
        if (
            this.contractDeployDepth >=
            OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_DEPLOYMENT_DEPTH
        ) {
            throw new Error('OP_NET: Contract deployment depth exceeded.');
        }

        this.contractDeployDepth++;
    }

    public isCallStackTooDeep(): boolean {
        return this.callStack.length >= OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_CALL_DEPTH;
    }

    public setStorage(pointer: MemorySlotPointer, value: MemorySlotData<bigint>): void {
        const current: PointerStorage =
            this.storage.get(this.contractAddress) || this.onNewStorage();

        current.set(pointer, value);

        this.storage.set(this.contractAddress, current);
    }

    public addToStorage(pointer: bigint, value: bigint): void {
        const current: PointerStorage =
            this.preloadStorage.get(this.contractAddress) || this.onNewStorage();

        if (current.has(pointer)) {
            throw new Error('OP_NET: Impossible case, storage already set.');
        }

        current.set(pointer, value);

        this.preloadStorage.set(this.contractAddress, current);
    }

    public getStorage(pointer: MemorySlotPointer): MemorySlotData<bigint> | undefined {
        const current = this.storage.get(this.contractAddress);
        const inPreload = this.preloadStorage.get(this.contractAddress);

        if (!current) {
            if (inPreload) {
                return inPreload.get(pointer);
            }

            return;
        }

        const val = current.get(pointer);
        if (val !== undefined) {
            return val;
        }

        return inPreload?.get(pointer);
    }

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
        if (extern.maxGas !== this.maxGas) {
            throw new Error('OP_NET: Impossible state. (max gas does not match)');
        }

        this.gasTracker.setGasUsed(extern.gasUsed);

        // we must merge the storage of the external calls
        if (extern.revert) {
            this._revert = extern.revert;

            return;
        }

        this.callStack = extern.callStack;
        if (OPNetConsensus.consensus.TRANSACTIONS.REENTRANCY_GUARD) {
            this.checkReentrancy();
        }

        this.contractDeployDepth = extern.contractDeployDepth;

        if (extern.modifiedStorage) {
            this.mergeStorage(extern.modifiedStorage);
        }

        if (extern.events) {
            this.mergeEvents(extern.events);
        }
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
            loadedStorage: this.preloadStorage,
            result: result,
            events: events,
            gasUsed: this.gasUsed,
            deployedContracts: Array.from(deployedContracts.values()),
        };

        if (this._revert) {
            resp.revert = this._revert;
        }

        return resp;
    }

    public addContractInformation(contract: ContractInformation): void {
        if (this.deployedContracts.has(contract.contractTweakedPublicKey)) {
            throw new Error('OP_NET: Contract already deployed.');
        }

        this.deployedContracts.set(contract.contractTweakedPublicKey, contract);
    }

    public preloadedStorage(storage: ProvenPointers | null): void {
        if (!storage) {
            return;
        }

        for (const [address, pointers] of storage) {
            const current: PointerStorage = this.preloadStorage.get(address) || this.onNewStorage();

            for (const [key, value] of pointers) {
                const pointerBigInt = BufferHelper.uint8ArrayToPointer(key);
                const pointerValueBigInt = value
                    ? BufferHelper.uint8ArrayToPointer(value.value)
                    : 0n;

                current.set(pointerBigInt, pointerValueBigInt);
            }

            this.preloadStorage.set(address, current);
        }
    }

    private onNewStorage(): DeterministicMap<MemorySlotPointer, MemorySlotData<bigint>> {
        return new DeterministicMap((a: bigint, b: bigint) => {
            return BinaryReader.bigintCompare(a, b);
        });
    }

    private setTotalEventSize(size: number) {
        const newSize: number = this._totalEventSize + size;
        if (newSize > OPNetConsensus.consensus.TRANSACTIONS.EVENTS.MAXIMUM_TOTAL_EVENT_LENGTH) {
            throw new Error('OP_NET: Maximum total event length exceeded.');
        }

        this._totalEventSize = newSize;
    }

    private enforceEventLimits(event: NetEvent): void {
        // Enforce event limits
        if (event.data.length > OPNetConsensus.consensus.TRANSACTIONS.EVENTS.MAXIMUM_EVENT_LENGTH) {
            throw new Error('OP_NET: Maximum event length exceeded.');
        }

        // Enforce event type length limit
        if (
            event.type.length >
            OPNetConsensus.consensus.TRANSACTIONS.EVENTS.MAXIMUM_EVENT_NAME_LENGTH
        ) {
            throw new Error('OP_NET: Maximum event type length exceeded.');
        }

        // Enforce total event size limit
        this.setTotalEventSize(event.data.byteLength);
    }

    private computeInputUTXOs(): Uint8Array {
        const maxInputs = Math.min(
            OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_INPUTS,
            this.inputs.length,
        );

        const writer = new BinaryWriter();
        writer.writeU16(maxInputs);

        const flagsEnabled = OPNetConsensus.consensus.VM.UTXOS.WRITE_FLAGS;
        for (let i = 0; i < maxInputs; i++) {
            const input = this.inputs[i];

            if (flagsEnabled) {
                writer.writeU8(input.flags);
            }

            writer.writeBytes(input.txId);
            writer.writeU16(input.outputIndex);
            writer.writeBytesWithLength(input.scriptSig);

            if (flagsEnabled && input.flags & TransactionInputFlags.hasCoinbase) {
                if (!input.coinbase) {
                    throw new Error('OP_NET: Impossible case, input.coinbase is undefined.');
                }

                writer.writeBytesWithLength(input.coinbase);
            }
        }

        return writer.getBuffer();
    }

    private computeOutputUTXOs(): Uint8Array {
        const maxOutputs = Math.min(
            OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_OUTPUTS,
            this.outputs.length,
        );

        const writer = new BinaryWriter();
        writer.writeU16(maxOutputs);

        const flagsEnabled = OPNetConsensus.consensus.VM.UTXOS.WRITE_FLAGS;
        for (let i = 0; i < maxOutputs; i++) {
            const output = this.outputs[i];
            if (flagsEnabled) {
                writer.writeU8(output.flags);
            }

            writer.writeU16(output.index);

            if (flagsEnabled && output.flags & TransactionOutputFlags.hasScriptPubKey) {
                writer.writeBytesWithLength(output.scriptPubKey);
            }

            // TODO: Clean this up for mainnet.
            if (output.flags & TransactionOutputFlags.hasTo) {
                if (!output.to) {
                    throw new Error('OP_NET: Impossible case, output.to is undefined.');
                }

                writer.writeStringWithLength(output.to);
            } else if (!flagsEnabled) {
                if (!output.to) {
                    throw new Error('OP_NET: Impossible case, output.to is undefined.');
                }

                writer.writeStringWithLength(output.to);
            }

            writer.writeU64(output.value);
        }

        return writer.getBuffer();
    }

    private checkReentrancy(): void {
        if (this.callStack.includes(this.contractAddress)) {
            throw new Error('OP_NET: Reentrancy detected.');
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
                        throw new Error(`OP_NET: Invalid access list key or value.`);
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

            throw new Error(`OP_NET: Cannot parse access list.`);
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
