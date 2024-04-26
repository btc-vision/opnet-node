import { Context } from 'node:vm';

import { ContractEvaluator } from '../runtime/ContractEvaluator.js';
import { MemoryValue } from '../storage/types/MemoryValue.js';

import { StoragePointer } from '../storage/types/StoragePointer.js';

export interface VMContext {
    logs: string[];
    errors: string[];

    getStorage: (
        address: string,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null,
        setIfNotExit: boolean,
    ) => Promise<MemoryValue | null>;

    setStorage: (address: string, pointer: StoragePointer, value: MemoryValue) => Promise<void>;

    contract: ContractEvaluator | null;
    contractAddress: string;

    rndPromise: () => Promise<void>;

    readonly ContractEvaluator: typeof ContractEvaluator;

    initialBytecode: Buffer;
}

export interface ExtendedContext {
    readonly context: VMContext;
}

export type EvaluatedContext = ExtendedContext & Context;
