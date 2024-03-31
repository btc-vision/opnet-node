import { Selector } from '../buffer/BinaryReader.js';
import { Address } from '../buffer/types/math.js';

export type VMRuntime = {
    INIT(owner, self): Number;

    readMethod(method: Selector, calldata: Uint8Array, caller?: Address | null): Uint8Array;
    readView(method: Selector): Uint8Array;

    getViewABI(): Uint8Array;
    getMethodABI(): Uint8Array;
};

export declare function instantiate(bytecode: Buffer, state: {}): Promise<VMRuntime>;
