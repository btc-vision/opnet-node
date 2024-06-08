import { Selector } from '../buffer/BinaryReader.js';
import { Address } from '../buffer/types/math.js';

export type VMRuntime = {
    INIT(owner: string, contractAddress: string): Promise<void>;

    getContract(): Promise<Number>;

    readMethod(
        method: Selector,
        contract: Number | null,
        calldata: Uint8Array,
        caller?: Address | null,
    ): Promise<Uint8Array>;

    readView(method: Selector, contract?: Number | null): Promise<Uint8Array>;

    getViewABI(): Promise<Uint8Array>;
    getEvents(): Promise<Uint8Array>;
    getMethodABI(): Promise<Uint8Array>;
    getWriteMethods(): Promise<Uint8Array>;

    /**
     * src/btc/exports/index/getModifiedStorage
     * @returns `~lib/typedarray/Uint8Array`
     */
    getModifiedStorage(): Promise<Uint8Array>;

    /**
     * src/btc/exports/index/initializeStorage
     * @returns `~lib/typedarray/Uint8Array`
     */
    initializeStorage(): Promise<Uint8Array>;

    loadStorage(data: Uint8Array): Promise<void>;

    isInitialized(): Promise<boolean>;

    purgeMemory(): Promise<void>;

    setMaxGas(maxGas: bigint): Promise<void>;
};

export declare function instantiate(bytecode: Buffer, state: {}): Promise<VMRuntime>;
