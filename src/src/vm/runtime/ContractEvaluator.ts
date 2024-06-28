import {
    Address,
    ADDRESS_BYTE_LENGTH,
    BinaryReader,
    BinaryWriter,
    BufferHelper,
    DeterministicMap,
    DeterministicSet,
    MemorySlotPointer,
    MethodMap,
    NetEvent,
    Selector,
    SelectorsMap,
} from '@btc-vision/bsi-binary';
import { MemoryValue } from '../storage/types/MemoryValue.js';
import { StoragePointer } from '../storage/types/StoragePointer.js';
import { Logger } from '@btc-vision/bsi-common';
import {
    ExecutionParameters,
    InternalContractCallParameters,
} from './types/InternalContractCallParameters.js';
import { ContractEvaluation } from './classes/ContractEvaluation.js';
import { ContractParameters, ExportedContract, loadRust } from '../isolated/LoaderV2.js';
import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';

/*import * as v8 from 'node:v8';

v8.setFlagsFromString('--expose_gc');

const gc: (() => void) | undefined = global.gc;
if (!gc) {
    throw new Error('Garbage collector not exposed');
}*/

export class ContractEvaluator extends Logger {
    private static readonly MAX_CONTRACT_EXTERN_CALLS: number = 8;

    public readonly logColor: string = '#00ffe1';

    private isProcessing: boolean = false;

    private viewAbi: SelectorsMap = new DeterministicMap(BinaryReader.stringCompare);
    private methodAbi: MethodMap = new DeterministicSet<Selector>(BinaryReader.numberCompare);
    private writeMethods: MethodMap = new DeterministicSet<Selector>(BinaryReader.numberCompare);

    private contractOwner: Address | undefined;
    private contractAddress: Address | undefined;

    private bytecode: Buffer | undefined;
    private readonly enableTracing: boolean = false;

    constructor() {
        super();
    }

    private _contractInstance: ExportedContract | undefined;

    private get contractInstance(): ExportedContract {
        if (!this._contractInstance) throw new Error('Contract not initialized');

        return this._contractInstance;
    }

    public deployContract(_contract: ContractInformation): Promise<void> {
        throw new Error('Method not implemented. [deployContract]');
    }

    public getStorage(
        _address: Address,
        _pointer: StoragePointer,
        _defaultValue: MemoryValue | null,
        _setIfNotExit: boolean,
        _blockNumber: bigint,
    ): Promise<MemoryValue | null> {
        throw new Error('Method not implemented. [getStorage]');
    }

    public setStorage(
        _address: Address,
        _pointer: StoragePointer,
        _value: MemoryValue,
    ): Promise<void> {
        throw new Error('Method not implemented. [setStorage]');
    }

    public async callExternal(
        _params: InternalContractCallParameters,
    ): Promise<ContractEvaluation> {
        throw new Error('Method not implemented. [callExternal]');
    }

    public async deployContractAtAddress(
        _address: Address,
        _salt: Buffer,
        _evaluation: ContractEvaluation,
    ): Promise<
        | {
              contractAddress: Address;
              virtualAddress: Buffer;
              bytecodeLength: bigint;
          }
        | undefined
    > {
        throw new Error('Method not implemented. [deployContractAtAddress]');
    }

    public setContractInformation(contractInformation: ContractInformation): void {
        // We use pub the pub key as the deployer address.
        const contractDeployer: string = contractInformation.deployerAddress;
        if (!contractDeployer || contractDeployer.length > ADDRESS_BYTE_LENGTH) {
            throw new Error(`Invalid contract deployer "${contractDeployer}"`);
        }

        this.contractOwner = contractDeployer;
        this.contractAddress = contractInformation.contractAddress;
        this.bytecode = contractInformation.bytecode;
    }

    public delete(): void {
        this.contractInstance.dispose();
        delete this._contractInstance;
    }

    public getViewSelectors(): SelectorsMap {
        return this.viewAbi;
    }

    public getMethodSelectors(): MethodMap {
        return this.methodAbi;
    }

    public getWriteMethods(): MethodMap {
        return this.writeMethods;
    }

    public isViewMethod(selector: Selector): boolean {
        const keys = Array.from(this.viewAbi.values());

        for (const key of keys) {
            if (key === selector) {
                return true;
            }
        }

        return false;
    }

    public async execute(params: ExecutionParameters): Promise<ContractEvaluation> {
        if (this.isProcessing) {
            throw new Error('Contract is already processing');
        }

        try {
            this.isProcessing = true;

            const evaluation = new ContractEvaluation({
                ...params,
                canWrite: false,
            });

            await this.loadContractFromBytecode(evaluation);
            await this.defineSelectorAndSetupEnvironment(evaluation);
            await this.setupContract();

            if (!evaluation.calldata && !evaluation.isView) {
                throw new Error('Calldata is required.');
            }

            const canWrite: boolean = this.canWrite(evaluation.abi);
            evaluation.setCanWrite(canWrite);

            try {
                // We execute the method.
                await this.evaluate(evaluation);
            } catch (e) {
                evaluation.revert = e as Error;
            }

            this.isProcessing = false;

            this.delete();

            if (this.enableTracing) {
                console.log(
                    `EXECUTION GAS USED: ${evaluation.gasTracker.gasUsed} - TRANSACTION FINAL GAS: ${evaluation.gasUsed} - TOOK ${evaluation.gasTracker.timeSpent}ms`,
                );
            }

            return evaluation;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    private async defineSelectorAndSetupEnvironment(params: ExecutionParameters): Promise<void> {
        await this.setEnvironment(
            params.caller,
            params.callee,
            params.blockMedian,
            params.blockNumber,
        );

        await this.contractInstance.defineSelectors();
    }

    // TODO: Cache this, (add the gas it took to compute in the final gas)
    private async setupContract(): Promise<void> {
        this.viewAbi = await this.getViewABI();
        this.methodAbi = await this.getMethodABI();
        this.writeMethods = await this.getWriteMethodABI();
    }

    /** Load a pointer */
    private async load(data: Buffer, evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        const reader: BinaryReader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();

        const pointerResponse: bigint = (await this.getStorageState(evaluation, pointer)) || 0n;

        if (this.enableTracing) {
            this.debug(`Loaded pointer ${pointer} - value ${pointerResponse}`);
        }

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(pointerResponse);

        return response.getBuffer();
    }

    /** Store a pointer */
    private async store(
        data: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        if (this.enableTracing) {
            this.debug(`Attempting to store pointer ${pointer} - value ${value}`);
        }

        evaluation.setStorage(pointer, value);

        const response: BinaryWriter = new BinaryWriter();
        response.writeBoolean(true); // if we want to add something in the future, we can.

        return response.getBuffer();
    }

    /** Call a contract */
    private async call(data: Buffer, evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);

        throw new Error('Not implemented [call]');
    }

    // TODO: Implement this
    private async deployContractFromAddressRaw(
        data: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<Buffer | Uint8Array> {
        evaluation.incrementContractDeployDepth(); // always first.

        const reader = new BinaryReader(data);
        const address: Address = reader.readAddress();
        const salt: Buffer = Buffer.from(reader.readBytes(32));

        const deployResult = await this.deployContractAtAddress(address, salt, evaluation);
        if (!deployResult) {
            throw new Error('Unable to deploy contract');
        }

        const response = new BinaryWriter();
        response.writeBytes(deployResult.virtualAddress);
        response.writeAddress(deployResult.contractAddress);
        response.writeU64(deployResult.bytecodeLength);

        return response.getBuffer();
    }

    private generateContractParameters(evaluation: ContractEvaluation): ContractParameters {
        if (!this.bytecode) {
            throw new Error('Bytecode is required');
        }

        return {
            bytecode: this.bytecode,
            gasLimit: OPNetConsensus.consensus.TRANSACTIONS.MAX_GAS,
            gasCallback: evaluation.onGasUsed,
            load: async (data: Buffer) => {
                return await this.load(data, evaluation);
            },
            store: async (data: Buffer) => {
                return await this.store(data, evaluation);
            },
            call: async (data: Buffer) => {
                return await this.call(data, evaluation);
            },
            deployContractAtAddress: async (data: Buffer) => {
                return await this.deployContractFromAddressRaw(data, evaluation);
            },
        };
    }

    private async loadContractFromBytecode(evaluation: ContractEvaluation): Promise<boolean> {
        let errored: boolean = false;
        try {
            this._contractInstance = await loadRust(this.generateContractParameters(evaluation));
        } catch (e) {
            console.log(`Unable to load contract from bytecode: ${(e as Error).stack}`);
            errored = true;
        }

        return errored;
    }

    private async internalGetStorage(
        address: Address,
        pointer: StoragePointer,
        defaultValueBuffer: MemoryValue | null,
        setIfNotExit: boolean = false,
        blockNumber: bigint,
    ): Promise<MemoryValue | null> {
        if (setIfNotExit && defaultValueBuffer === null) {
            throw new Error('Default value buffer is required');
        }

        const canInitialize: boolean = address === this.contractAddress ? setIfNotExit : false;

        return this.getStorage(address, pointer, defaultValueBuffer, canInitialize, blockNumber);
    }

    private async evaluate(evaluation: ContractEvaluation): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const hasSelectorInMethods = this.methodAbi.has(evaluation.abi) ?? false;

        let result: Uint8Array | undefined;
        let error: Error | undefined;

        // TODO: Check the pointer header when getting the result so we dont have to reconstruct the buffer in ram.
        try {
            result = hasSelectorInMethods
                ? await this.contractInstance.readMethod(evaluation.abi, evaluation.calldata)
                : await this.contractInstance.readView(evaluation.abi);
        } catch (e) {
            error = (await e) as Error;
        }

        if (error || !result) {
            if (!evaluation.revert && error) {
                evaluation.revert = error;
            } else {
                console.log(`Error: ${error}`);
            }

            return;
        }

        // Move that in the header check
        if (result.length > OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_RECEIPT_LENGTH) {
            evaluation.revert = new Error('Result is too long');

            return;
        }

        let deploymentPromises: Promise<void>[] = [];
        if (evaluation.deployedContracts.length > 0) {
            for (let i = 0; i < evaluation.deployedContracts.length; i++) {
                const contract = evaluation.deployedContracts[i];
                deploymentPromises.push(this.deployContract(contract));
            }
        }

        // We deploy contract at the end of the transaction.
        // This transaction should not be able to interact with the contract it just deployed.
        // This is on purpose.
        await Promise.all(deploymentPromises);

        const events: NetEvent[] = await this.getEvents();
        evaluation.setEvent(evaluation.contractAddress, events);
        evaluation.setResult(result);
    }

    private async getEvents(): Promise<NetEvent[]> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getEvents();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readEvents();
    }

    /*private async writeCallsResponse(
        caller: Address,
        blockNumber: bigint,
        blockMedian: bigint,
    ): Promise<void> {
        if (!this.contractInstance || !this.contractAddress) {
            throw new Error('Contract not initialized');
        }

        for (let [externCallAddress, externCall] of this.externalCalls) {
            if (externCall.length > ContractEvaluator.MAX_CONTRACT_EXTERN_CALLS) {
                throw new Error('Too many external calls');
            }

            const responses: ContractEvaluation[] =
                this.externalCallsResponse.get(externCallAddress) || [];

            if (responses.length !== externCall.length) {
                // We have to do more calls

                for (let i = responses.length; i < externCall.length; i++) {
                    if (this.gasTracker.gasUsed >= this.gasTracker.maxGas) {
                        throw new Error('execution reverted (out of gas)');
                    }

                    const externalCallParams: InternalContractCallParameters = {
                        contractAddress: externCallAddress,
                        from: caller,
                        callee: this.contractAddress,

                        maxGas: this.gasTracker.maxGas,
                        gasUsed: this.gasTracker.gasUsed,

                        externalCall: true,
                        blockHeight: blockNumber,
                        blockMedian: blockMedian,

                        // data
                        calldata: Buffer.from(externCall[i].buffer),
                    };

                    const response = await this.vmIsolator.callExternal(externalCallParams);
                    if (!response) throw new Error('external call reverted.');

                    // we add the gas used to the gas tracker
                    this.gasTracker.addGasUsed(response.gasUsed);

                    responses.push(response);
                }
            }

            this.externalCallsResponse.set(externCallAddress, responses);
        }

        const binaryWriter: BinaryWriter = new BinaryWriter();
        const responses = this.getExternalCallResponses();
        binaryWriter.writeLimitedAddressBytesMap(responses);

        const buf: Uint8Array = binaryWriter.getBuffer();
        await this.contractInstance.loadCallsResponse(buf);
    }*/

    private async setEnvironment(
        caller: Address,
        callee: Address,
        blockNumber: bigint,
        blockMedian: bigint,
    ): Promise<void> {
        if (!this.contractInstance || !this.contractOwner || !this.contractAddress) {
            throw new Error('Contract not initialized');
        }

        const binaryWriter: BinaryWriter = new BinaryWriter();
        binaryWriter.writeAddress(caller);
        binaryWriter.writeAddress(callee);
        binaryWriter.writeU256(blockNumber);
        binaryWriter.writeAddress(this.contractOwner);
        binaryWriter.writeAddress(this.contractAddress);
        binaryWriter.writeU256(blockMedian);

        await this.contractInstance.setEnvironment(binaryWriter.getBuffer());
    }

    private hasSameKeysMap(
        map1: DeterministicMap<unknown, unknown>,
        map2: DeterministicMap<unknown, unknown>,
    ): boolean {
        if (map1.size !== map2.size) {
            return false;
        }

        for (const [key] of map1) {
            if (!map2.has(key)) {
                return false;
            }
        }

        for (const [key] of map2) {
            if (!map1.has(key)) {
                return false;
            }
        }

        return true;
    }

    private async getStorageState(
        evaluation: ContractEvaluation,
        pointer: MemorySlotPointer,
    ): Promise<bigint | null> {
        const rawData: MemoryValue = BufferHelper.pointerToUint8Array(pointer);
        const value: MemoryValue | null = await this.internalGetStorage(
            evaluation.contractAddress,
            rawData,
            null,
            false,
            evaluation.blockNumber,
        );

        return value ? BufferHelper.uint8ArrayToValue(value) : null;
    }

    /*private async setStorageState(
        address: Address,
        pointer: MemorySlotPointer,
        value: MemorySlotData<bigint>,
    ): Promise<void> {
        const rawData: MemoryValue = BufferHelper.pointerToUint8Array(pointer);
        const valueBuffer: MemoryValue = BufferHelper.valueToUint8Array(value);

        await this.setStorage(address, rawData, valueBuffer);
    }*/

    /*private async updateStorage(modifiedStorage: BlockchainStorage): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [key, value] of modifiedStorage) {
            for (const [k, v] of value) {
                promises.push(
                    this.setStorageState(key, k, v).catch((e: Error) => {
                        throw e;
                    }),
                );
            }
        }

        await Promise.all(promises);
    }*/

    private canWrite(abi: Selector): boolean {
        return this.writeMethods.has(abi);
    }

    private async getViewABI(): Promise<SelectorsMap> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getViewABI();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readViewSelectorsMap();
    }

    private async getMethodABI(): Promise<MethodMap> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getMethodABI();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readMethodSelectorsMap();
    }

    private async getWriteMethodABI(): Promise<MethodMap> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getWriteMethods();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readMethodSelectorsMap();
    }
}
