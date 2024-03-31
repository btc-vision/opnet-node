import { Context } from 'node:vm';

// @ts-ignore
import * as wasm from '../../config/runDebug.js';

import { VMRuntime } from '../wasmRuntime/runDebug.js';
import { EvaluatedResult } from './EvaluatedResult.js';

export interface VMContext {
    readonly logs: string[] | null;
    readonly errors: string[] | null;

    readonly result: Partial<EvaluatedResult> | null;

    instantiate: (bytecode: Buffer, state: {}) => Promise<VMRuntime>;

    getStorage: (address: string, pointer: Buffer) => Buffer;
    setStorage: (address: string, pointer: Buffer, value: Buffer) => void;

    contract: VMRuntime | null;

    initialBytecode: Buffer;
}

export interface EvaluatedContext extends Context {
    readonly context: VMContext;
}
