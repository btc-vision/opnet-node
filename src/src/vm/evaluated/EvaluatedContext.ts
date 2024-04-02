import { Context } from 'node:vm';

// @ts-ignore
import * as wasm from '../../config/runDebug.js';
import { MemoryValue } from '../storage/types/MemoryValue.js';
import { StoragePointer } from '../storage/types/StoragePointer.js';

import { VMRuntime } from '../wasmRuntime/runDebug.js';
import { EvaluatedResult } from './EvaluatedResult.js';

export interface VMContext {
    readonly logs: string[] | null;
    readonly errors: string[] | null;

    readonly result: Partial<EvaluatedResult> | null;

    instantiate: (bytecode: Buffer, state: {}) => Promise<VMRuntime>;

    getStorage: (address: string, pointer: StoragePointer) => Promise<MemoryValue | null>;
    setStorage: (address: string, pointer: StoragePointer, value: MemoryValue) => Promise<void>;

    contract: VMRuntime | null;

    initialBytecode: Buffer;
}

export interface EvaluatedContext extends Context {
    readonly context: VMContext;
}
