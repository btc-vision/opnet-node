import { BufferHelper } from '../../utils/BufferHelper.js';
import { BinaryReader } from '../buffer/BinaryReader.js';
import { BinaryWriter } from '../buffer/BinaryWriter.js';
import {
    Address,
    BlockchainStorage,
    MemorySlotData,
    MemorySlotPointer,
    MethodMap,
    PointerStorage,
    Selector,
    SelectorsMap,
} from '../buffer/types/math.js';
import { VMContext } from '../evaluated/EvaluatedContext.js';
import { EvaluatedResult } from '../evaluated/EvaluatedResult.js';
import { NetEvent } from '../events/NetEvent.js';
import { MemoryValue } from '../storage/types/MemoryValue.js';
import { StoragePointer } from '../storage/types/StoragePointer.js';
import { instantiate, VMRuntime } from '../wasmRuntime/runDebug.js';

export class ContractEvaluator {
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

    private readonly enableTracing: boolean = false;

    constructor(
        private readonly stack: VMContext,
        private readonly console: Console,
    ) {
        void this.init();
    }

    public get wasm(): VMRuntime | null {
        return this.contractInstance;
    }

    public async init(): Promise<void> {
        this.contractInstance = await this.instantiatedContract(this.stack.initialBytecode, {});
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
            address === this.stack.contractAddress ? setIfNotExit : false;

        return this.stack.getStorage(address, pointer, defaultValueBuffer, canInitialize);
    }

    public async rndPromise(): Promise<void> {
        return await this.stack.rndPromise();
    }

    public async setStorage(
        address: string,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        if (address !== this.stack.contractAddress) {
            throw new Error('Contract attempted to set storage for another contract.');
        }

        return this.stack.setStorage(address, pointer, value);
    }

    public async setupContract(owner: Address, contractAddress: Address): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (this.contractRef !== 0) {
            throw new Error('Contract already initialized');
        }

        await this.rndPromise();

        this.contractInstance.INIT(owner, contractAddress);
        this.contractRef = this.contractInstance.getContract();

        this.viewAbi = this.getViewABI();
        this.methodAbi = this.getMethodABI();
        this.writeMethods = this.getWriteMethodABI();

        this.originalStorageState = this.getDefaultInitialStorage();

        this.initializeContract = true;
    }

    public getContract(): Number {
        return this.contractRef;
    }

    public clear(): void {
        this.currentStorageState.clear();
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
        const methodAbi = this.viewAbi.get(this.stack.contractAddress);

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

        const canWrite = this.canWrite(address, abi);
        if (!isView && !canWrite) {
            throw new Error('Method is not allowed to write');
        }

        if (!calldata && !isView) {
            throw new Error('Calldata is required for method call');
        }

        try {
            // We execute the method.
            const resp: EvaluatedResult | undefined = await this.evaluate(
                address,
                abi,
                calldata,
                caller,
                canWrite,
            );

            this.isProcessing = false;

            return resp;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    public export(): void {
        this.stack.contract = this;
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

        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const contract = this.methodAbi.get(contractAddress);
        const isInitialized = this.isInitialized();

        if (!isInitialized) {
            throw new Error('Contract not initialized');
        }

        this.writeCurrentStorageState();

        const hasSelectorInMethods = contract?.has(abi) ?? false;

        let result: Uint8Array | undefined = undefined;
        let error: Error | undefined = undefined;
        try {
            if (hasSelectorInMethods) {
                result = this.contractInstance.readMethod(
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

        this.clear();

        const events = this.getEvents();
        return {
            result: result,
            events: events,
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

    private async instantiatedContract(bytecode: Buffer, state: {}): Promise<VMRuntime> {
        return instantiate(bytecode, state);
    }

    /*private getMergedStorageState(): BlockchainStorage {
        const mergedStorageState: BlockchainStorage = new Map();

        for (const [key, value] of this.persistentStorageState) {
            const newStorage: PointerStorage = new Map();

            for (const [k, v] of value) {
                newStorage.set(k, v);
            }

            mergedStorageState.set(key, newStorage);
        }

        for (const [key, value] of this.currentStorageState) {
            const existingValue = mergedStorageState.get(key);

            if (existingValue) {
                for (const [k, v] of value) {
                    existingValue.set(k, v);
                }
            } else {
                const newStorage: PointerStorage = new Map();

                for (const [k, v] of value) {
                    newStorage.set(k, v);
                }

                mergedStorageState.set(key, newStorage);
            }
        }

        return mergedStorageState;
    }*/

    private writeCurrentStorageState(): void {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        this.binaryWriter.writeStorage(this.currentStorageState);

        if (this.enableTracing) {
            console.log('WRITING CURRENT STORAGE STATE', this.currentStorageState);
        }

        const buf: Uint8Array = this.binaryWriter.getBuffer();

        this.contractInstance.purgeMemory();
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
