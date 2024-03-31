import { Selector } from '../buffer/BinaryReader.js';
import { Address } from '../buffer/types/math.js';

export type VMRuntime = {
    INIT(owner, self): Number;

    readMethod(
        method: Selector,
        contract: Number | null,
        calldata: Uint8Array,
        caller?: Address | null,
    ): Uint8Array;

    readView(method: Selector): Uint8Array;

    getViewABI(): Uint8Array;
    getMethodABI(): Uint8Array;

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
};

export declare function instantiate(bytecode: Buffer, state: {}): Promise<VMRuntime>;