import { BinaryReader } from '../buffer/BinaryReader.js';
import { BinaryWriter } from '../buffer/BinaryWriter.js';
import {
    Address,
    BlockchainRequestedStorage,
    BlockchainStorage,
    MemorySlotData,
    MemorySlotPointer,
    PointerStorage,
    Selector,
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

    private contractRef: Number = 0;

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

    public async getStorage(address: string, pointer: StoragePointer): Promise<MemoryValue | null> {
        return this.stack.getStorage(address, pointer);
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
        this.currentStorageState.clear();

        return this.binaryWriter.getBuffer();
    }

    public getLogs(): string[] {
        return this.stack.logs;
    }

    public async setupContract(owner: string, contractAddress: string): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        this.persistentStorageState.clear();

        this.contractInstance.INIT(owner, contractAddress);
        this.contractRef = this.contractInstance.getContract();

        const requiredPersistentStorage = this.getCurrentStorageState();
        const modifiedStorage = this.getMergedStorageState();

        console.log('persistent', requiredPersistentStorage, modifiedStorage);

        await this.loadPersistentStorageState(requiredPersistentStorage, modifiedStorage);
    }

    private async loadPersistentStorageState(
        requestPersistentStorage: BlockchainRequestedStorage,
        modifiedStorage: BlockchainStorage,
    ): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        if (this.persistentStorageState.size !== 0) {
            throw new Error('Persistent storage already loaded');
        }

        const loadedPromises: Promise<void>[] = [];
        for (const [key, value] of requestPersistentStorage) {
            const storage: PointerStorage = new Map();
            this.persistentStorageState.set(key, storage);

            const defaultPointerStorage = modifiedStorage.get(key);
            if (!defaultPointerStorage) {
                throw new Error(
                    `Uninitialized contract ${key} found. Please initialize the contract first.`,
                );
            }

            for (let v of value) {
                const defaultPointer: MemorySlotData<bigint> | undefined =
                    defaultPointerStorage.get(v);
                if (defaultPointer === undefined || defaultPointer === null) {
                    throw new Error(
                        'Uninitialized pointer. Please initialize the memory pointer in the contract first.',
                    );
                }

                loadedPromises.push(this.setPersistentStorageState(key, v, defaultPointer));
            }
        }

        await Promise.all(loadedPromises);
    }

    private async setPersistentStorageState(
        address: Address,
        pointer: MemorySlotPointer,
        defaultValue: MemorySlotData<bigint>,
    ): Promise<void> {
        const rawData: Buffer = Buffer.from('0x' + pointer.toString(16), 'hex');
        const value: Buffer | null = await this.getStorage(address, rawData);

        const finalValue: bigint =
            value === null ? defaultValue : BigInt('0x' + value.toString('hex'));

        const pointerStorage: PointerStorage | undefined = this.persistentStorageState.get(address);
        if (!pointerStorage) {
            throw new Error(`Pointer storage ${address} not found`);
        }

        pointerStorage.set(pointer, finalValue);
    }

    private getCurrentStorageState(): BlockchainRequestedStorage {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const requiredStorage: Uint8Array = this.contractInstance.getRequiredStorage();
        console.log(requiredStorage);

        const binaryReader = new BinaryReader(requiredStorage);

        return binaryReader.readRequestedStorage();
    }

    public getContract(): Number {
        return this.contractRef;
    }

    public async evaluateTransaction(): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        try {
            this.contractInstance.purgeMemory();
            this.contractInstance.loadStorage(this.writeCurrentStorageState());
        } catch (e) {
            throw e;
        }
    }

    public async execute(
        abi: Selector,
        calldata: Uint8Array,
        caller?: Address | null,
    ): Promise<Uint8Array> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        return this.contractInstance.readMethod(abi, this.getContract(), calldata, caller);
    }

    public get wasm(): VMRuntime | null {
        return this.contractInstance;
    }

    public export(): void {
        this.stack.contract = this;
    }
}
