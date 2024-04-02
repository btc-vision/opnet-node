import { Context } from 'node:vm';

// @ts-ignore
import * as wasm from '../../config/runDebug.js';
import { ContractEvaluator } from '../runtime/ContractEvaluator.js';
import { MemoryValue } from '../storage/types/MemoryValue.js';

import { StoragePointer } from '../storage/types/StoragePointer.js';
import { EvaluatedResult } from './EvaluatedResult.js';

export interface VMContext {
    logs: string[];
    errors: string[];

    result: Partial<EvaluatedResult> | null;

    getStorage: (
        address: string,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null,
        setIfNotExit: boolean,
    ) => Promise<MemoryValue | null>;
    setStorage: (address: string, pointer: StoragePointer, value: MemoryValue) => Promise<void>;

    contract: ContractEvaluator | null;

    readonly ContractEvaluator: typeof ContractEvaluator;

    initialBytecode: Buffer;
}

export interface ExtendedContext {
    readonly context: VMContext;
}

export type EvaluatedContext = ExtendedContext & Context;
