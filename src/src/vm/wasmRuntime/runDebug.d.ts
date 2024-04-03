import { Selector } from '../buffer/BinaryReader.js';
import { Address } from '../buffer/types/math.js';

export type VMRuntime = {
    INIT(owner: string, contractAddress: string): void;

    getContract(): Number;

    readMethod(
        method: Selector,
        contract: Number | null,
        calldata: Uint8Array,
        caller?: Address | null,
    ): Uint8Array;

    readView(method: Selector, contract?: Number | null): Uint8Array;

    getViewABI(): Uint8Array;
    getMethodABI(): Uint8Array;
    getWriteMethods(): Uint8Array;

    /**
     * src/btc/exports/index/getRequiredStorage
     * @returns `~lib/typedarray/Uint8Array`
     */
    getRequiredStorage(): Uint8Array;

    /**
     * src/btc/exports/index/getModifiedStorage
     * @returns `~lib/typedarray/Uint8Array`
     */
    getModifiedStorage(): Uint8Array;

    growMemory(size: number): number;

    loadStorage(data: Uint8Array): void;

    allocateMemory(size: number): number;

    isInitialized(): boolean;

    purgeMemory(): void;
};

export declare function instantiate(bytecode: Buffer, state: {}): Promise<VMRuntime>;
