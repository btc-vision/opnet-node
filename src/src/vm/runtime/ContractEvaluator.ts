import {
    Address,
    BinaryReader,
    BinaryWriter,
    BlockchainStorage,
    BufferHelper,
    MemorySlotData,
    MemorySlotPointer,
    MethodMap,
    NetEvent,
    PointerStorage,
    Selector,
    SelectorsMap,
} from '@btc-vision/bsi-binary';
import { EvaluatedEvents, EvaluatedResult } from '../evaluated/EvaluatedResult.js';
import { MemoryValue } from '../storage/types/MemoryValue.js';
import { StoragePointer } from '../storage/types/StoragePointer.js';
import { VMIsolator } from '../VMIsolator.js';
import { GasTracker } from './GasTracker.js';
import { VMRuntime } from '../wasmRuntime/VMRuntime.js';
import { Logger } from '@btc-vision/bsi-common';
import {
    ExecutionParameters,
    InternalContractCallParameters,
} from './types/InternalContractCallParameters.js';
import { ContractEvaluation } from './classes/ContractEvaluation.js';
import { ExternalCalls, ExternalCallsResult } from './types/ExternalCall.js';

export class ContractEvaluator extends Logger {
    private static readonly MAX_ERROR_DEPTH: number = 100;
    private static readonly MAX_CONTRACT_EXTERN_CALLS: number = 8;

    public readonly logColor: string = '#00ffe1';

    private contractInstance: VMRuntime | null = null;

    private currentStorageState: BlockchainStorage = new Map();
    private originalStorageState: BlockchainStorage = new Map();

    private contractRef: Number = 0;
    private isProcessing: boolean = false;
    private viewAbi: SelectorsMap = new Map();
    private methodAbi: MethodMap = new Map();
    private writeMethods: MethodMap = new Map();
    private initializeContract: boolean = false;

    private contractOwner: Address | undefined;
    private contractAddress: Address | undefined;

    private externalCalls: ExternalCalls = new Map();
    private externalCallsResponse: ExternalCallsResult = new Map();

    /** Gas tracking. */
    private gasTracker: GasTracker = new GasTracker(); // TODO: Remove this from the class, must be passed as a parameter instead.
    private initialGasTracker: GasTracker = new GasTracker();

    private readonly enableTracing: boolean = false;

    constructor(private readonly vmIsolator: VMIsolator) {
        super();
    }

    public get getGasUsed(): bigint {
        return this.gasTracker.gasUsed;
    }

    public get owner(): Address {
        if (!this.contractOwner) throw new Error('Contract owner not set');

        return this.contractOwner;
    }

    public async init(runtime: VMRuntime): Promise<void> {
        this.contractInstance = runtime;

        this.gasTracker.disableTracking(this.vmIsolator.CPUTime);
        this.vmIsolator.onGasUsed = (gas: bigint): void => {
            this.gasTracker.addGasUsed(gas);
            this.initialGasTracker.addGasUsed(gas);

            if (!this.initialGasTracker.isEnabled() && !this.gasTracker.isEnabled()) {
                throw new Error('Gas used is not being tracked.');
            }
        };
    }

    public async setMaxGas(rlGas: bigint, currentGasUsage?: bigint): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        this.gasTracker.reset();
        this.gasTracker.enableTracking(this.vmIsolator.CPUTime);

        this.gasTracker.maxGas = rlGas;
        if (currentGasUsage) this.gasTracker.gasUsed = currentGasUsage;

        await this.contractInstance.setMaxGas(rlGas, currentGasUsage);
    }

    public async getStorage(
        address: string,
        pointer: StoragePointer,
        defaultValueBuffer: MemoryValue | null,
        setIfNotExit: boolean = true,
    ): Promise<MemoryValue | null> {
        if (setIfNotExit && defaultValueBuffer === null) {
            throw new Error('Default value buffer is required');
        }

        const canInitialize: boolean =
            address === this.vmIsolator.contractAddress ? setIfNotExit : false;

        return this.vmIsolator.getStorage(address, pointer, defaultValueBuffer, canInitialize);
    }

    public async setStorage(
        address: string,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        return this.vmIsolator.setStorage(address, pointer, value);
    }

    public async setupContract(owner: Address, contractAddress: Address): Promise<void> {
        if (!owner || !contractAddress) {
            throw new Error('Owner and contract address are required');
        }

        this.originalStorageState.clear();
        this.currentStorageState.clear();
        this.externalCalls.clear();
        this.externalCallsResponse.clear();

        this.initialGasTracker.reset();
        this.initialGasTracker.enableTracking(this.vmIsolator.CPUTime);

        this.contractOwner = owner;
        this.contractAddress = contractAddress;

        if (!this.contractInstance) {
            throw new Error('No contract instance');
        }

        if (this.contractRef !== 0) {
            throw new Error('Contract already initialized');
        }

        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        await this.contractInstance.INIT(owner, contractAddress);

        this.contractRef = await this.contractInstance.getContract();

        this.viewAbi = await this.getViewABI();
        this.methodAbi = await this.getMethodABI();
        this.writeMethods = await this.getWriteMethodABI();

        this.originalStorageState = await this.getDefaultInitialStorage();

        this.initialGasTracker.disableTracking(this.vmIsolator.CPUTime);
        this.initializeContract = true;
    }

    public getContract(): Number {
        return this.contractRef;
    }

    public clear(): void {
        this.currentStorageState.clear();
        this.externalCallsResponse.clear();
        this.externalCalls.clear();
    }

    public dispose(): void {
        this.vmIsolator.dispose();
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

    public async isInitialized(): Promise<boolean> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        return await this.contractInstance.isInitialized();
    }

    public isViewMethod(abi: Selector): boolean {
        const methodAbi = this.viewAbi.get(this.vmIsolator.contractAddress);

        if (!methodAbi) {
            throw new Error(`Contract has no methods`);
        }

        const values = methodAbi.values();
        for (const value of values) {
            if (value === abi) {
                return true;
            }
        }

        return false;
    }

    public async execute(params: ExecutionParameters): Promise<ContractEvaluation> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (this.isProcessing) {
            throw new Error('Contract is already processing');
        }

        this.isProcessing = true;

        // We restore the original storage state before executing the method.
        await this.restoreOriginalStorageState();

        if (!params.calldata && !params.isView) {
            throw new Error('Calldata is required.');
        }

        const canWrite: boolean = this.canWrite(params.contractAddress, params.abi);
        const evaluation = new ContractEvaluation({
            ...params,
            canWrite,
        });

        try {
            // We execute the method.
            const resp: EvaluatedResult | undefined = await this.evaluate(evaluation);

            this.gasTracker.disableTracking(this.vmIsolator.CPUTime);
            if (resp && this.enableTracing) {
                console.log(
                    `INITIAL GAS USED: ${this.initialGasTracker.gasUsed} - EXECUTION GAS USED: ${this.gasTracker.gasUsed} - TRANSACTION FINAL GAS: ${resp.gasUsed} - TOOK ${this.gasTracker.timeSpent}ns`,
                );
            }

            this.isProcessing = false;

            return evaluation;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    public async preventDamage(): Promise<void> {
        try {
            if (!this.contractAddress || !this.contractOwner) return;
            this.initializeContract = false;
            this.contractRef = 0;

            await this.vmIsolator.reset();
            await this.setupContract(this.contractOwner, this.contractAddress);
        } catch (e) {
            console.error(`UNABLE TO PURGE MEMORY: ${(e as Error).stack}`);
        }
    }

    private async restoreOriginalStorageState(): Promise<void> {
        // We clear the current storage state, this make sure that we are not using any previous storage state.
        this.clear();

        /** We update persistent storage state in case we want to do future call on the same contract instance. */

        // The current persistent default storage is the same as the original storage state.
        this.currentStorageState = await this.getCurrentStorageStates(this.originalStorageState);

        if (this.enableTracing) {
            console.log('RESTORED INITIAL', this.currentStorageState);
        }
    }

    // TODO: IMPORTANT. Move all these function parameter into an object, create the class EvaluatedTransaction
    private async evaluate(evaluation: ContractEvaluation): Promise<EvaluatedResult> {
        if (!this.initializeContract) {
            throw new Error('Contract not initialized');
        }

        if (evaluation.tries > ContractEvaluator.MAX_ERROR_DEPTH) {
            this.warn('Max error depth reached');
            throw new Error('Max error depth reached');
        }

        const events: EvaluatedEvents = new Map();
        const contract = this.methodAbi.get(evaluation.contractAddress);
        const isInitialized = await this.isInitialized();
        if (!isInitialized) {
            throw new Error('Contract not initialized');
        }

        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        await this.writeCurrentStorageState();
        await this.writeCallsResponse(evaluation.caller);
        await this.setEnvironment(evaluation.caller, evaluation.callee);

        const hasSelectorInMethods = contract?.has(evaluation.abi) ?? false;

        let result: Uint8Array | undefined;
        let error: Error | undefined;

        try {
            if (hasSelectorInMethods) {
                result = await this.contractInstance.readMethod(
                    evaluation.abi,
                    this.getContract(),
                    evaluation.calldata,
                    evaluation.caller,
                );
            } else {
                result = await this.contractInstance.readView(evaluation.abi);
            }
        } catch (e) {
            error = e as Error;
        }

        if (error && typeof error === 'object' && error.message.includes('out of gas')) {
            throw error;
        }

        // Check for required storage slots.
        const initialStorage: BlockchainStorage = await this.getDefaultInitialStorage();
        const sameStorage: boolean = this.isStorageRequiredTheSame(initialStorage);

        // Check for external calls
        const externalCalls: ExternalCalls = await this.getExternalCalls();
        const sameExternalCalls: boolean = await this.sameExternalCalls(externalCalls);
        if (!result && sameExternalCalls && sameStorage) {
            throw error;
        }

        this.externalCalls = externalCalls;
        this.currentStorageState = await this.getCurrentStorageStates(initialStorage);

        if (!result) {
            evaluation.incrementTries();

            return await this.evaluate(evaluation);
        }

        evaluation.setEvents(events);
        evaluation.setInitialStorage(initialStorage);
        evaluation.setSameStorage(sameStorage);
        evaluation.setResult(result);

        // TODO: IMPORTANT. Move that to a method in the class EvaluatedTransaction
        return await this.evaluateTransaction(evaluation);
    }

    // TODO: IMPORTANT. Move all these function parameter into an object, create the class EvaluatedTransaction
    private async evaluateTransaction(evaluation: ContractEvaluation): Promise<EvaluatedResult> {
        const modifiedStorage: BlockchainStorage = await this.getCurrentModifiedStorageState();
        if (!evaluation.sameStorage) {
            if (this.enableTracing) {
                console.log(
                    `TEMP CALL STORAGE ACCESS LIST FOR ${evaluation.abi} (took ${evaluation.tries}) -> initialStorage:`,
                    evaluation.initialStorage,
                    'currentState:',
                    this.currentStorageState,
                    'modified storage:',
                    modifiedStorage,
                );
            }

            evaluation.incrementTries();

            return await this.evaluate(evaluation);
        }

        if (evaluation.canWrite) {
            if (this.verifyIfStorageModifiedDoesNotModifyAnOtherContract(modifiedStorage)) {
                throw new Error('execution reverted (unable to modify)');
            }
        }

        const selfEvents: NetEvent[] = await this.getEvents();
        evaluation.setEvent(evaluation.contractAddress, selfEvents);

        const gasUsed: bigint = this.gasTracker.gasUsed + this.initialGasTracker.gasUsed;

        evaluation.setModifiedStorage(modifiedStorage);
        evaluation.processExternalCalls(this.externalCallsResponse);
        evaluation.setGasUsed(gasUsed);

        if (evaluation.canWrite) {
            if (this.enableTracing) {
                console.log(
                    `FINAL CALL STORAGE ACCESS LIST FOR ${evaluation.abi} (took ${evaluation.tries}) -> initialStorage:`,
                    evaluation.initialStorage,
                    'currentState:',
                    this.currentStorageState,
                    'modified storage:',
                    modifiedStorage,
                );
            }

            await this.updateStorage(modifiedStorage).catch((e: Error) => {
                throw e;
            });
        }

        this.clear();

        return evaluation.getEvaluationResult();
    }

    private async getExternalCalls(): Promise<ExternalCalls> {
        if (!this.contractInstance) throw new Error('Contract not initialized');

        const callBuffer: Uint8Array = await this.contractInstance.getCalls();
        const reader = new BinaryReader(callBuffer);

        return reader.readMultiBytesAddressMap();
    }

    private async sameExternalCalls(externalCalls: ExternalCalls): Promise<boolean> {
        for (let [contract, calls] of externalCalls) {
            const callRequest = this.externalCalls.get(contract);
            if (!callRequest) return false;

            if (calls.length !== callRequest.length) return false;

            for (let i = 0; i < calls.length; i++) {
                const callLength = calls[i].length;
                const callRequestLength = callRequest[i].length;

                if (callLength !== callRequestLength) return false;
            }
        }

        return true;
    }

    private async getEvents(): Promise<NetEvent[]> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getEvents();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readEvents();
    }

    private async writeCurrentStorageState(): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        await this.contractInstance.purgeMemory();

        const binaryWriter: BinaryWriter = new BinaryWriter();
        binaryWriter.writeStorage(this.currentStorageState);

        if (this.enableTracing) {
            console.log('WRITING CURRENT STORAGE STATE', this.currentStorageState);
        }

        const buf: Uint8Array = binaryWriter.getBuffer();
        await this.contractInstance.loadStorage(buf);
    }

    private async writeCallsResponse(caller: Address): Promise<void> {
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

                        // data
                        calldata: Buffer.from(externCall[i].buffer),
                    };

                    this.info(`CALLING EXTERNAL CONTRACT ${externCallAddress} (${i})`);

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
    }

    private getExternalCallResponses(): ExternalCalls {
        const externalCalls: ExternalCalls = new Map();

        for (let [contract, calls] of this.externalCallsResponse) {
            const responses: Uint8Array[] = [];
            for (let response of calls) {
                if (!response.result) throw new Error('external call reverted.');
                responses.push(response.result);
            }

            externalCalls.set(contract, responses);
        }

        return externalCalls;
    }

    private async setEnvironment(caller: Address, callee: Address): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const binaryWriter: BinaryWriter = new BinaryWriter();
        binaryWriter.writeAddress(caller);
        binaryWriter.writeAddress(callee);

        await this.contractInstance.setEnvironment(binaryWriter.getBuffer());
    }

    private hasSameKeysMap(map1: Map<unknown, unknown>, map2: Map<unknown, unknown>): boolean {
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

    private isStorageRequiredTheSame(requiredStorageAfter: BlockchainStorage): boolean {
        if (this.currentStorageState.size !== requiredStorageAfter.size) {
            return false;
        }

        for (const [key, value] of this.currentStorageState) {
            const valueAfter = requiredStorageAfter.get(key);

            if (valueAfter === undefined) {
                return false;
            }

            if (value.size !== valueAfter.size) {
                return false;
            }

            if (!this.hasSameKeysMap(value, valueAfter)) {
                return false;
            }
        }

        for (const [key, value] of requiredStorageAfter) {
            const valueAfter = this.currentStorageState.get(key);

            if (valueAfter === undefined) {
                return false;
            }

            if (value.size !== valueAfter.size) {
                return false;
            }

            if (!this.hasSameKeysMap(value, valueAfter)) {
                return false;
            }
        }

        return true;
    }

    private async getCurrentStorageStates(
        defaultStorage: BlockchainStorage,
        isView: boolean = false,
    ): Promise<BlockchainStorage> {
        const currentStorage: BlockchainStorage = new Map();
        const loadedPromises: Promise<void>[] = [];

        // We iterate over all the requested contract storage slots
        for (let [key, value] of defaultStorage) {
            const storage: PointerStorage = new Map();

            // We iterate over all the storage keys and get the current value
            for (let [k, v] of value) {
                // We get the current value of the storage slot
                loadedPromises.push(this.getStorageState(key, k, v, storage, isView));
            }

            currentStorage.set(key, storage);
        }

        await Promise.all(loadedPromises);

        return currentStorage;
    }

    private async getStorageState(
        address: Address,
        pointer: MemorySlotPointer,
        defaultValue: MemorySlotData<bigint>,
        pointerStorage: PointerStorage,
        isView: boolean,
    ): Promise<void> {
        const rawData: MemoryValue = BufferHelper.pointerToUint8Array(pointer);
        const defaultValueBuffer: MemoryValue = BufferHelper.valueToUint8Array(defaultValue);

        const value: MemoryValue | null = await this.getStorage(
            address,
            rawData,
            defaultValueBuffer,
            !isView,
        );

        const valHex = value ? BufferHelper.uint8ArrayToValue(value) : null;
        const finalValue: bigint = valHex === null ? defaultValue : valHex;

        pointerStorage.set(pointer, finalValue);
    }

    private async setStorageState(
        address: Address,
        pointer: MemorySlotPointer,
        value: MemorySlotData<bigint>,
    ): Promise<void> {
        const rawData: MemoryValue = BufferHelper.pointerToUint8Array(pointer);
        const valueBuffer: MemoryValue = BufferHelper.valueToUint8Array(value);

        await this.setStorage(address, rawData, valueBuffer);
    }

    private async getCurrentModifiedStorageState(): Promise<BlockchainStorage> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const storage: Uint8Array = await this.contractInstance.getModifiedStorage();
        const binaryReader = new BinaryReader(storage);

        return binaryReader.readStorage();
    }

    private async getDefaultInitialStorage(): Promise<BlockchainStorage> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const storage: Uint8Array = await this.contractInstance.initializeStorage();
        const binaryReader = new BinaryReader(storage);

        const resp = binaryReader.readStorage();

        if (this.originalStorageState.size !== 0) {
            // we must merge the original storage state with the new one
            for (const [key, value] of this.originalStorageState) {
                const newStorage: PointerStorage = resp.get(key) || new Map();

                for (const [k, v] of value) {
                    if (!newStorage.has(k)) {
                        newStorage.set(k, v);
                    }
                }

                resp.set(key, newStorage);
            }
        }

        return resp;
    }

    private verifyIfStorageModifiedDoesNotModifyAnOtherContract(
        modifiedStorage: BlockchainStorage,
    ): boolean {
        for (const [key] of modifiedStorage) {
            if (key !== this.vmIsolator.contractAddress) {
                return true;
            }
        }

        return false;
    }

    private async updateStorage(modifiedStorage: BlockchainStorage): Promise<void> {
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
    }

    private canWrite(contractAddress: Address, abi: Selector): boolean {
        const writeMethodContract = this.writeMethods.get(contractAddress);

        if (!writeMethodContract) {
            return false;
        }

        return writeMethodContract.has(abi);
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
