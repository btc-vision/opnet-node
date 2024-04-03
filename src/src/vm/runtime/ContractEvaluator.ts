import { BinaryReader } from '../buffer/BinaryReader.js';
import { BinaryWriter } from '../buffer/BinaryWriter.js';
import {
    Address,
    BlockchainRequestedStorage,
    BlockchainStorage,
    MemorySlotData,
    MemorySlotPointer,
    MethodMap,
    PointerStorage,
    Selector,
    SelectorsMap,
} from '../buffer/types/math.js';
import { VMContext } from '../evaluated/EvaluatedContext.js';
import { MemoryValue } from '../storage/types/MemoryValue.js';
import { StoragePointer } from '../storage/types/StoragePointer.js';
import { instantiate, VMRuntime } from '../wasmRuntime/runDebug.js';

export class ContractEvaluator {
    private contractInstance: VMRuntime | null = null;
    private binaryWriter: BinaryWriter = new BinaryWriter();

    private currentStorageState: BlockchainStorage = new Map();
    private persistentStorageState: BlockchainStorage = new Map();

    private currentRequiredStorage: BlockchainRequestedStorage = new Map();

    private contractRef: Number = 0;
    private isProcessing: boolean = false;

    constructor(
        private readonly stack: VMContext,
        private readonly console: Console,
    ) {
        void this.init();
    }

    private async instantiatedContract(bytecode: Buffer, state: {}): Promise<VMRuntime> {
        return instantiate(bytecode, state);
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

        return this.stack.getStorage(address, pointer, defaultValueBuffer, setIfNotExit);
    }

    public async rndPromise(): Promise<void> {
        return await this.stack.rndPromise();
    }

    public async setStorage(
        address: string,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        return this.stack.setStorage(address, pointer, value);
    }

    private getMergedStorageState(): BlockchainStorage {
        const mergedStorageState: BlockchainStorage = new Map();

        for (const [key, value] of this.persistentStorageState) {
            mergedStorageState.set(key, value);
        }

        for (const [key, value] of this.currentStorageState) {
            const existingValue = mergedStorageState.get(key);

            if (existingValue) {
                for (const [k, v] of value) {
                    existingValue.set(k, v);
                }
            }
        }

        return mergedStorageState;
    }

    private writeCurrentStorageState(): Uint8Array {
        const storage = this.getMergedStorageState();

        this.binaryWriter.writeStorage(storage);

        return this.binaryWriter.getBuffer();
    }

    private sameRequiredStorage(
        requiredStorageBefore: BlockchainRequestedStorage,
        requiredStorageAfter: BlockchainRequestedStorage,
    ): boolean {
        if (requiredStorageBefore.size !== requiredStorageAfter.size) {
            return false;
        }

        for (const [key, value] of requiredStorageBefore) {
            const valueAfter = requiredStorageAfter.get(key);

            if (!valueAfter) {
                return false;
            }

            if (value.size !== valueAfter.size) {
                return false;
            }

            for (const v of value) {
                if (!valueAfter.has(v)) {
                    return false;
                }
            }
        }

        return true;
    }

    public getLogs(): string[] {
        return this.stack.logs;
    }

    private viewAbi: SelectorsMap = new Map();
    private methodAbi: MethodMap = new Map();

    private initializeContract: boolean = false;

    public async setupContract(owner: string, contractAddress: string): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (this.contractRef !== 0) {
            throw new Error('Contract already initialized');
        }

        await this.rndPromise();

        this.persistentStorageState.clear();

        this.contractInstance.INIT(owner, contractAddress);
        this.contractRef = this.contractInstance.getContract();

        this.viewAbi = this.getViewABI();
        this.methodAbi = this.getMethodABI();

        const requiredPersistentStorage = this.getCurrentStorageState();
        const modifiedStorage = this.getCurrentModifiedStorageState();

        await this.loadPersistentStorageState(
            requiredPersistentStorage,
            modifiedStorage,
            this.persistentStorageState,
        );

        this.initializeContract = true;
    }

    private async loadPersistentStorageState(
        requestPersistentStorage: BlockchainRequestedStorage,
        modifiedStorage: BlockchainStorage,
        initialStorage: BlockchainStorage = this.persistentStorageState,
    ): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (initialStorage.size !== 0) {
            throw new Error('Persistent storage already loaded');
        }

        const loadedPromises: Promise<void>[] = [];
        for (const [key, value] of requestPersistentStorage) {
            const storage: PointerStorage = initialStorage.get(key) || new Map();
            if (!initialStorage.has(key)) {
                initialStorage.set(key, storage);
            }

            const defaultPointerStorage = modifiedStorage.get(key);
            if (!defaultPointerStorage) {
                throw new Error(
                    `Uninitialized contract ${key} found. Please initialize the contract first.`,
                );
            }

            for (let v of value) {
                const hasValue = storage.has(v);
                if (hasValue) {
                    continue;
                }

                const defaultPointer: MemorySlotData<bigint> | undefined =
                    defaultPointerStorage.get(v);

                if (defaultPointer === undefined || defaultPointer === null) {
                    throw new Error(
                        'Uninitialized pointer. Please initialize the memory pointer in the contract first.',
                    );
                }

                loadedPromises.push(this.setStorageState(key, v, defaultPointer, storage));
            }
        }

        await Promise.all(loadedPromises);
    }

    private async setStorageState(
        address: Address,
        pointer: MemorySlotPointer,
        defaultValue: MemorySlotData<bigint>,
        pointerStorage: PointerStorage,
    ): Promise<void> {
        const rawData: Buffer = Buffer.from(pointer.toString(16), 'hex');
        const defaultValueBuffer: Buffer = Buffer.from(defaultValue.toString(16), 'hex');

        const value: Buffer | null = await this.getStorage(
            address,
            rawData,
            defaultValueBuffer,
            true,
        );

        const finalValue: bigint =
            value === null ? defaultValue : BigInt('0x' + value.toString('hex'));

        pointerStorage.set(pointer, finalValue);
    }

    private getCurrentStorageState(): BlockchainRequestedStorage {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const requiredStorage: Uint8Array = this.contractInstance.getRequiredStorage();
        const binaryReader = new BinaryReader(requiredStorage);

        return binaryReader.readRequestedStorage();
    }

    private getCurrentModifiedStorageState(): BlockchainStorage {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const storage: Uint8Array = this.contractInstance.getModifiedStorage();
        const binaryReader = new BinaryReader(storage);

        return binaryReader.readStorage();
    }

    public getContract(): Number {
        return this.contractRef;
    }

    public clear(): void {
        this.currentStorageState.clear();
        this.persistentStorageState.clear();
        this.currentRequiredStorage.clear();
    }

    public async evaluate(
        abi: Selector,
        isView: boolean,
        calldata: Uint8Array | null,
        caller?: Address | null,
    ): Promise<Uint8Array | undefined> {
        if (!this.initializeContract) {
            throw new Error('Contract not initialized');
        }

        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (!calldata && !isView) {
            throw new Error('Calldata is required for method call');
        }

        const isInitialized = this.isInitialized();
        if (!isInitialized) {
            throw new Error('Contract not initialized');
        }

        try {
            this.currentStorageState.clear();
            this.contractInstance.purgeMemory();

            const toAllocate = this.writeCurrentStorageState();
            this.contractInstance.loadStorage(toAllocate);

            let result: Uint8Array;
            if (!isView) {
                result = this.contractInstance.readMethod(
                    abi,
                    this.getContract(),
                    calldata as Uint8Array,
                    caller,
                );
            } else {
                result = this.contractInstance.readView(abi);
            }

            const requiredStorageAfter = this.getCurrentStorageState();
            const sameStorage = this.sameRequiredStorage(
                this.currentRequiredStorage,
                requiredStorageAfter,
            );

            this.currentRequiredStorage.clear();
            this.currentRequiredStorage = requiredStorageAfter;

            const modifiedStorage = this.getCurrentModifiedStorageState();
            await this.loadPersistentStorageState(
                requiredStorageAfter,
                modifiedStorage,
                this.currentStorageState,
            );

            if (!sameStorage) {
                console.log(`STORAGE SLOTS CHANGED. RELOADING...`);
                await this.evaluate(abi, isView, calldata, caller);
            } else {
                console.log(`LOADED ALL REQUIRED STORAGE SLOTS. THIS RESULT IS FINAL.`);
                this.clear();

                return result;
            }
        } catch (e) {
            throw e;
        }
    }

    public getViewSelectors(): SelectorsMap {
        return this.viewAbi;
    }

    public getMethodSelectors(): MethodMap {
        return this.methodAbi;
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

    public isInitialized(): boolean {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        return this.contractInstance.isInitialized();
    }

    public async execute(
        isView: boolean,
        abi: Selector,
        calldata: Uint8Array | null = null,
        caller: Address | null = null,
    ): Promise<Uint8Array | undefined> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (this.isProcessing) {
            throw new Error('Contract is already processing');
        }

        this.isProcessing = true;

        try {
            const resp = await this.evaluate(abi, isView, calldata, caller);

            this.isProcessing = false;

            return resp;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    public get wasm(): VMRuntime | null {
        return this.contractInstance;
    }

    public export(): void {
        this.stack.contract = this;
    }
}
