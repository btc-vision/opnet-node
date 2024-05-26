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
import { EvaluatedResult } from '../evaluated/EvaluatedResult.js';
import { MemoryValue } from '../storage/types/MemoryValue.js';
import { StoragePointer } from '../storage/types/StoragePointer.js';
import { VMIsolator } from '../VMIsolator.js';
import { VMRuntime } from '../wasmRuntime/runDebug.js';
import { GasTracker } from './GasTracker.js';

export class ContractEvaluator {
    private static readonly SAT_TO_GAS_RATIO: bigint = 100030750n; //30750n; //611805;

    private contractInstance: VMRuntime | null = null;
    private binaryWriter: BinaryWriter = new BinaryWriter();

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

    /** Gas tracking. */
    private gasTracker: GasTracker = new GasTracker(VMIsolator.MAX_GAS); // TODO: Remove this from the class, must be passed as a parameter instead.
    private initialGasTracker: GasTracker = new GasTracker(VMIsolator.MAX_GAS);

    private readonly enableTracing: boolean = false;

    constructor(private readonly vmIsolator: VMIsolator) {}

    public get getGasUsed(): bigint {
        return this.gasTracker.gasUsed;
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

            if (this.initialGasTracker.isEnabled()) {
                console.log(
                    `INIT CONTRACT GAS USED: ${gas} - TOTAL GAS: ${this.initialGasTracker.gasUsed}`,
                );
            }

            if (this.gasTracker.isEnabled()) {
                console.log(`EXECUTION GAS USED: ${gas} - TOTAL GAS: ${this.gasTracker.gasUsed}`);
            }
        };
    }

    public setMaxGas(maxGas: bigint): void {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const rlGas: bigint = this.convertSatToGas(maxGas);

        this.gasTracker.reset();
        this.gasTracker.enableTracking(this.vmIsolator.CPUTime);

        this.gasTracker.maxGas = rlGas;
        this.contractInstance.setMaxGas(rlGas);
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
        if (address !== this.vmIsolator.contractAddress) {
            throw new Error('Contract attempted to set storage for another contract.');
        }

        return this.vmIsolator.setStorage(address, pointer, value);
    }

    public async setupContract(owner: Address, contractAddress: Address): Promise<void> {
        if (!owner || !contractAddress) {
            throw new Error('Owner and contract address are required');
        }

        this.originalStorageState.clear();
        this.currentStorageState.clear();

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

        this.contractInstance.INIT(owner, contractAddress);

        this.contractRef = this.contractInstance.getContract();

        this.viewAbi = this.getViewABI();
        this.methodAbi = this.getMethodABI();
        this.writeMethods = this.getWriteMethodABI();

        this.originalStorageState = this.getDefaultInitialStorage();

        this.initialGasTracker.disableTracking(this.vmIsolator.CPUTime);
        console.log('final.');

        this.initializeContract = true;
    }

    public getContract(): Number {
        return this.contractRef;
    }

    public clear(): void {
        this.currentStorageState.clear();
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

    public isInitialized(): boolean {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        return this.contractInstance.isInitialized();
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

    public async execute(
        address: Address,
        isView: boolean,
        abi: Selector,
        calldata: Uint8Array | null = null,
        caller: Address | null = null,
    ): Promise<EvaluatedResult> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (this.isProcessing) {
            throw new Error('Contract is already processing');
        }

        this.isProcessing = true;

        // We restore the original storage state before executing the method.
        await this.restoreOriginalStorageState();

        if (!calldata && !isView) {
            throw new Error('Calldata is required.');
        }

        const canWrite: boolean = this.canWrite(address, abi);
        try {
            // We execute the method.
            const resp: EvaluatedResult | undefined = await this.evaluate(
                address,
                abi,
                calldata,
                caller,
                canWrite,
            );

            this.gasTracker.disableTracking(this.vmIsolator.CPUTime);
            if (resp) {
                console.log(
                    `INITIAL GAS USED: ${this.initialGasTracker.gasUsed} - EXECUTION GAS USED: ${this.gasTracker.gasUsed} - TRANSACTION FINAL GAS: ${resp.gasUsed} - TOOK ${this.gasTracker.timeSpent}ns`,
                );
            }

            this.isProcessing = false;

            return resp;
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

    private convertSatToGas(sat: bigint): bigint {
        return sat * ContractEvaluator.SAT_TO_GAS_RATIO;
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

    // TODO: Move all these function parameter into an object
    private async evaluate(
        contractAddress: Address,
        abi: Selector,
        calldata: Uint8Array | null,
        caller: Address | null = null,
        canWrite: boolean,
        tries: number = 0,
    ): Promise<EvaluatedResult> {
        if (!this.initializeContract) {
            throw new Error('Contract not initialized');
        }

        const contract = this.methodAbi.get(contractAddress);
        const isInitialized = this.isInitialized();
        if (!isInitialized) {
            throw new Error('Contract not initialized');
        }

        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        this.writeCurrentStorageState();

        const hasSelectorInMethods = contract?.has(abi) ?? false;

        let result: Uint8Array | undefined;
        let error: Error | undefined;

        try {
            if (hasSelectorInMethods) {
                result = await this.contractInstance.readMethod(
                    abi,
                    this.getContract(),
                    calldata as Uint8Array,
                    caller,
                );
            } else {
                result = this.contractInstance.readView(abi);
            }
        } catch (e) {
            error = e as Error;
        }

        if (error && typeof error === 'object' && error.message.includes('out of gas')) {
            throw error;
        }

        const initialStorage: BlockchainStorage = this.getDefaultInitialStorage();
        const sameStorage: boolean = this.isStorageRequiredTheSame(initialStorage);

        if (!result && sameStorage) {
            throw error;
        }

        this.currentStorageState = await this.getCurrentStorageStates(initialStorage);

        if (!result) {
            return await this.evaluate(contractAddress, abi, calldata, caller, canWrite, tries + 1);
        }

        return await this.evaluateTransaction(
            result,
            initialStorage,
            sameStorage,
            contractAddress,
            abi,
            calldata,
            caller,
            canWrite,
            tries,
        );
    }

    // TODO: Move all these function parameter into an object
    private async evaluateTransaction(
        result: Uint8Array,
        initialStorage: BlockchainStorage,
        sameStorage: boolean,
        contractAddress: Address,
        abi: Selector,
        calldata: Uint8Array | null,
        caller: Address | null = null,
        canWrite: boolean,
        tries: number,
    ): Promise<EvaluatedResult> {
        const modifiedStorage: BlockchainStorage = this.getCurrentModifiedStorageState();
        if (!sameStorage) {
            if (this.enableTracing) {
                console.log(
                    `TEMP CALL STORAGE ACCESS LIST FOR ${abi} (took ${tries}) -> initialStorage:`,
                    initialStorage,
                    'currentState:',
                    this.currentStorageState,
                    'modified storage:',
                    modifiedStorage,
                );
            }

            return await this.evaluate(contractAddress, abi, calldata, caller, canWrite, tries + 1);
        } else if (canWrite) {
            if (this.enableTracing) {
                console.log(
                    `FINAL CALL STORAGE ACCESS LIST FOR ${abi} (took ${tries}) -> initialStorage:`,
                    initialStorage,
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

        const events: NetEvent[] = this.getEvents();
        const gasUsed: bigint = this.gasTracker.gasUsed + this.initialGasTracker.gasUsed;

        this.clear();

        return {
            changedStorage: modifiedStorage,
            result: result,
            events: events,
            gasUsed: gasUsed,
        };
    }

    private getEvents(): NetEvent[] {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = this.contractInstance.getEvents();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readEvents();
    }

    private writeCurrentStorageState(): void {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        this.binaryWriter.writeStorage(this.currentStorageState);

        if (this.enableTracing) {
            console.log('WRITING CURRENT STORAGE STATE', this.currentStorageState);
        }

        const buf: Uint8Array = this.binaryWriter.getBuffer();
        this.contractInstance.loadStorage(buf);
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

    private getCurrentModifiedStorageState(): BlockchainStorage {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const storage: Uint8Array = this.contractInstance.getModifiedStorage();
        const binaryReader = new BinaryReader(storage);

        return binaryReader.readStorage();
    }

    private getDefaultInitialStorage(): BlockchainStorage {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const storage: Uint8Array = this.contractInstance.initializeStorage();
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

    private getViewABI(): SelectorsMap {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = this.contractInstance.getViewABI();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readViewSelectorsMap();
    }

    private getMethodABI(): MethodMap {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = this.contractInstance.getMethodABI();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readMethodSelectorsMap();
    }

    private getWriteMethodABI(): MethodMap {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = this.contractInstance.getWriteMethods();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readMethodSelectorsMap();
    }
}
